import { ipcMain, type BrowserWindow } from "electron";

/**
 * One-shot main -> renderer request.
 *
 * Several MCP tools need work that only the renderer can do (live Lexical/Yjs
 * editors, the shared-document index, extension tool hosts). Each sends on a
 * tool channel with a unique resultChannel and waits for a single reply.
 *
 * Callers differ in what a timeout means to them, so the outcome is returned
 * rather than formatted here: the timeout branch is where an extension tool
 * logs diagnostics and a collab read throws.
 */

export type RendererRequestResult<TResponse> =
  | { status: "responded"; response: TResponse }
  | { status: "timedOut" };

type RendererRequestOptions = {
  /** Per-tool budget; these differ deliberately (a directory read is not an applyDiff). */
  timeoutMs: number;
  /** Only affects the generated channel name, which is what shows up in IPC traces. */
  resultChannelPrefix?: string;
};

export function requestFromRenderer<TResponse>(
  window: BrowserWindow,
  channel: string,
  payload: Record<string, unknown>,
  options: RendererRequestOptions,
): Promise<RendererRequestResult<TResponse>> {
  const resultChannel = `${options.resultChannelPrefix ?? "mcp-result"}-${Date.now()}-${Math.random()}`;

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      // The reply is registered with ipcMain.once, so it lives in the event
      // registry. removeHandler() only clears ipcMain.handle() invoke handlers
      // and would leave this listener attached, leaking one per timeout until
      // MaxListenersExceededWarning.
      ipcMain.removeAllListeners(resultChannel);
      resolve({ status: "timedOut" });
    }, options.timeoutMs);

    ipcMain.once(resultChannel, (_event, response: TResponse) => {
      clearTimeout(timeout);
      resolve({ status: "responded", response });
    });

    window.webContents.send(channel, { ...payload, resultChannel });
  });
}
