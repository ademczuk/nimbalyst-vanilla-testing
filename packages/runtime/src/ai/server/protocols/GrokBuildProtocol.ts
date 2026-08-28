/**
 * Grok Build headless protocol adapter.
 *
 * Transport: `grok -p <prompt> --output-format streaming-json`, one process per
 * turn, with session continuity via a caller-supplied UUID (`-s` on the first
 * turn, `-r <id>` thereafter). Sessions persist under
 * `~/.grok/sessions/<url-encoded-cwd>/<id>`.
 *
 * `streaming-json` is documented as "NDJSON of the agent native ACP session
 * updates", but it is flat records with a `type` discriminator rather than
 * JSON-RPC frames, and it adds `rawInput` / `rawOutput` that plain ACP drops.
 * That extra payload is the reason this provider does not run on `grok agent
 * stdio` — see the Phase 0 comparison in the plan.
 *
 * Observed record types (2026-08-26, grok 1.0.5):
 *   {type:'thought',  data}                      reasoning delta
 *   {type:'text',     data}                      assistant text delta
 *   {type:'tool_call', toolCallId, toolName, kind, status, title, rawInput, locations}
 *   {type:'tool_call_update', toolCallId, status, content[], locations, rawOutput}
 *   {type:'available_commands', tools[], commands[]}
 *   {type:'usage', usage, signature}
 *   {type:'end', stopReason, sessionId, usage, num_turns, total_cost_usd, modelUsage}
 */

import path from 'path';
import {
  runHeadlessNdjson,
  HeadlessNdjsonExitError,
} from './headless/HeadlessNdjsonProcess';
import { mapGrokRecord as mapGrokRecordShared } from './headless/GrokBuildRecordMapper';
import type {
  AgentProtocol,
  ProtocolEvent,
  ProtocolMessage,
  ProtocolSession,
  SessionOptions,
} from './ProtocolInterface';

const PLATFORM = 'grok-build-headless';

interface GrokSessionRaw extends Record<string, unknown> {
  /** True until the first turn completes; drives `-s` vs `-r`. */
  isNew: boolean;
  workspacePath: string;
  model?: string;
}

export interface GrokBuildProtocolDeps {
  runNdjson?: typeof runHeadlessNdjson;
  randomUUID?: () => string;
}

export class GrokBuildProtocol implements AgentProtocol {
  readonly platform = PLATFORM;

  private grokPath = 'grok';
  private processEnv: Record<string, string> | null = null;
  private readonly runNdjson: typeof runHeadlessNdjson;
  private readonly randomUUID: () => string;

  constructor(deps?: GrokBuildProtocolDeps) {
    this.runNdjson = deps?.runNdjson ?? runHeadlessNdjson;
    this.randomUUID = deps?.randomUUID
      ?? (() => (globalThis.crypto as Crypto).randomUUID());
  }

  setGrokPath(executablePath: string): void {
    this.grokPath = executablePath;
  }

  setProcessEnv(env: Record<string, string> | null): void {
    this.processEnv = env;
  }

  async createSession(options: SessionOptions): Promise<ProtocolSession> {
    // Grok requires a fresh UUID that does not already exist under the target
    // session directory, and it will not create one for us in `-p` mode until
    // the turn runs. Minting it here is what lets the host persist a provider
    // session id before the first turn completes.
    return {
      id: this.randomUUID(),
      platform: PLATFORM,
      raw: {
        isNew: true,
        workspacePath: options.workspacePath,
        model: options.model,
      } satisfies GrokSessionRaw,
    };
  }

  async resumeSession(sessionId: string, options: SessionOptions): Promise<ProtocolSession> {
    return {
      id: sessionId,
      platform: PLATFORM,
      raw: {
        isNew: false,
        workspacePath: options.workspacePath,
        model: options.model,
      } satisfies GrokSessionRaw,
    };
  }

  async forkSession(sessionId: string, options: SessionOptions): Promise<ProtocolSession> {
    // `--fork-session` with `-s <new-id>` names the fork; the source is resumed
    // read-only, so the original session's history is untouched.
    const forkId = this.randomUUID();
    return {
      id: forkId,
      platform: PLATFORM,
      raw: {
        isNew: false,
        workspacePath: options.workspacePath,
        model: options.model,
        forkFrom: sessionId,
      } satisfies GrokSessionRaw & { forkFrom: string },
    };
  }

  async *sendMessage(
    session: ProtocolSession,
    message: ProtocolMessage,
  ): AsyncIterable<ProtocolEvent> {
    const raw = (session.raw ?? {}) as GrokSessionRaw & { forkFrom?: string };
    const workspacePath = raw.workspacePath;
    const args = this.buildArgs(session, raw, message);

    let sawEnd = false;
    try {
      for await (const item of this.runNdjson({
        command: this.grokPath,
        args,
        cwd: workspacePath,
        env: this.processEnv ?? undefined,
        abortSignal: message.abortSignal,
      })) {
        if (item.kind === 'garbage') continue;
        // Every record is persisted verbatim: the raw log is the sole source of
        // truth and the parser is derived from it.
        yield { type: 'raw_event', metadata: { rawEvent: item.value } };

        for (const event of mapGrokRecord(item.value, workspacePath)) {
          if (event.type === 'complete') sawEnd = true;
          yield event;
        }
      }
    } catch (error) {
      if (message.abortSignal?.aborted) return;
      yield { type: 'error', error: describeGrokFailure(error) };
      return;
    }

    // Grok emits `end` on every successful turn. Its absence means the process
    // died mid-stream; say so rather than presenting a truncated turn as done.
    if (!sawEnd && !message.abortSignal?.aborted) {
      yield { type: 'error', error: 'Grok ended the turn without a final result.' };
    }

    raw.isNew = false;
  }

  abortSession(_session: ProtocolSession): void {
    // Each turn owns its own child process, torn down via the per-message
    // abort signal in `runHeadlessNdjson`. Nothing outlives a turn.
  }

  cleanupSession(_session: ProtocolSession): void {
    // No long-lived resources; Grok's own session files are the user's.
  }

  private buildArgs(
    session: ProtocolSession,
    raw: GrokSessionRaw & { forkFrom?: string },
    message: ProtocolMessage,
  ): string[] {
    const args = ['-p', message.content, '--output-format', 'streaming-json'];

    args.push('--cwd', raw.workspacePath);

    if (raw.forkFrom) {
      args.push('-r', raw.forkFrom, '--fork-session', '-s', session.id);
    } else if (raw.isNew) {
      args.push('-s', session.id);
    } else {
      args.push('-r', session.id);
    }

    // Stored model ids are namespaced (`grok-build:grok-4.6`); the CLI wants
    // the bare id.
    const bareModel = raw.model ? stripProviderNamespace(raw.model) : undefined;
    if (bareModel) {
      args.push('-m', bareModel);
    }

    // Nimbalyst gates the whole turn up front (workspace trust + permission
    // mode) because Grok's headless mode has no per-tool approval callback.
    // Asking it to stop and prompt would hang a process nobody can answer.
    args.push('--always-approve');

    return args;
  }

}

/** Map one Grok record using the desktop protocol's platform path semantics. */
export function mapGrokRecord(
  record: Record<string, unknown>,
  workspacePath: string,
): ProtocolEvent[] {
  return mapGrokRecordShared(record, workspacePath, (base, filePath) => path.resolve(base, filePath));
}

function stripProviderNamespace(modelId: string): string {
  const separator = modelId.indexOf(':');
  return separator === -1 ? modelId : modelId.slice(separator + 1);
}

function describeGrokFailure(error: unknown): string {
  if (error instanceof HeadlessNdjsonExitError) {
    const stderr = error.stderr.toLowerCase();
    if (/not authenticated|not logged in|unauthorized|sign in/.test(stderr)) {
      return 'Grok is not signed in. Run `grok login` in your terminal, then try again.';
    }
    return error.message;
  }
  const messageText = error instanceof Error ? error.message : String(error);
  if (/ENOENT|spawn/i.test(messageText)) {
    return 'The Grok CLI was not found. Install it with:\n\n'
      + '  curl -fsSL https://x.ai/cli/install.sh | bash\n\n'
      + 'Then run `grok login` to authenticate.';
  }
  return messageText;
}
