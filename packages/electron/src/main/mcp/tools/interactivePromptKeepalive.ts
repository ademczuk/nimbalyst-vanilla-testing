// #1341: an interactive prompt blocks its MCP call for as long as the user
// takes to answer. Claude Code's client arms an idle watchdog per call and
// aborts when the server has sent neither a response nor a progress
// notification for the idle window -- 300s for our `sse` servers:
//
//   MCP server "nimbalyst" tool "AskUserQuestion" sent no response or progress
//   for 300s; aborting.
//
// A progress notification resets that timer (harness: `onprogress` sets
// `lastActivity = Date.now()`), and the hard per-call timeout defaults to ~27h,
// so a heartbeat while the prompt is pending removes the abort entirely --
// without the user having to raise CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT globally
// across every MCP server they have configured.
//
// The client only tracks progress for a call it issued a token for. Claude Code
// sends `_meta.progressToken` on every call; a client that does not is simply
// left alone.

/** Five heartbeats inside the 300s idle window, against a 30s client tick. */
export const INTERACTIVE_PROMPT_KEEPALIVE_MS = 60_000;

type ProgressToken = string | number;

export interface KeepaliveExtra {
  sendNotification?: (notification: {
    method: 'notifications/progress';
    params: { progressToken: ProgressToken; progress: number; message?: string };
  }) => Promise<void> | void;
}

export function extractProgressToken(request: unknown): ProgressToken | undefined {
  const meta = (request as { params?: { _meta?: unknown } } | undefined)?.params?._meta;
  if (!meta || typeof meta !== 'object') return undefined;
  const token = (meta as { progressToken?: unknown }).progressToken;
  return typeof token === 'string' || typeof token === 'number' ? token : undefined;
}

/**
 * Start heartbeating progress for a pending interactive prompt. Returns the
 * stop function; call it from the handler's settle path, on every exit.
 *
 * A no-op (returning a no-op stop) when the client sent no progress token or
 * the transport gives us no way to notify.
 */
export function startInteractivePromptKeepalive(params: {
  request: unknown;
  extra: KeepaliveExtra | undefined;
  toolName: string;
  intervalMs?: number;
}): () => void {
  const { request, extra, toolName } = params;
  const intervalMs = params.intervalMs ?? INTERACTIVE_PROMPT_KEEPALIVE_MS;
  const progressToken = extractProgressToken(request);
  const send = extra?.sendNotification;
  if (progressToken === undefined || typeof send !== 'function') {
    return () => {};
  }

  let progress = 0;
  const timer = setInterval(() => {
    progress += 1;
    try {
      // Best effort: a dead transport must not take the prompt down with it.
      // The IPC and DB settle paths are what actually deliver the answer.
      void Promise.resolve(
        send({
          method: 'notifications/progress',
          params: {
            progressToken,
            progress,
            message: `Waiting for the user to respond to ${toolName}`,
          },
        }),
      ).catch(() => {});
    } catch {
      // Same reasoning as above.
    }
  }, intervalMs);

  return () => clearInterval(timer);
}

export interface InteractivePromptCallExtra extends KeepaliveExtra {
  signal?: { aborted: boolean; addEventListener: (type: 'abort', listener: () => void, opts?: { once?: boolean }) => void; removeEventListener: (type: 'abort', listener: () => void) => void };
}

/**
 * Everything a blocking interactive prompt needs from its MCP call: heartbeat
 * it so the client's idle watchdog leaves it alone, and hear about it if the
 * client gives up on it anyway.
 *
 * Without the abort half (NIM-2607), a cancelled call left the waiter pending
 * forever: the "awaiting input" bit stuck, the IPC listeners and DB poll leaked,
 * and the widget kept offering buttons whose answer had nowhere to go.
 *
 * Returns a detach function; call it from the handler's settle path. `onAbort`
 * fires at most once, and never after detach.
 */
export function attachInteractivePromptCall(params: {
  request: unknown;
  extra: InteractivePromptCallExtra | undefined;
  toolName: string;
  onAbort: () => void;
  intervalMs?: number;
}): () => void {
  const { extra, onAbort } = params;
  const stopKeepalive = startInteractivePromptKeepalive(params);

  const signal = extra?.signal;
  if (!signal || typeof signal.addEventListener !== 'function') {
    return stopKeepalive;
  }

  if (signal.aborted) {
    stopKeepalive();
    onAbort();
    return () => {};
  }

  let detached = false;
  const listener = () => {
    if (detached) return;
    detached = true;
    stopKeepalive();
    onAbort();
  };
  signal.addEventListener('abort', listener, { once: true });

  return () => {
    if (detached) return;
    detached = true;
    stopKeepalive();
    try {
      signal.removeEventListener('abort', listener);
    } catch {
      // A transport that hands us a one-shot signal is fine; the listener is
      // guarded by `detached` either way.
    }
  };
}
