/**
 * Clipboard utilities that route through Electron's native clipboard via IPC.
 *
 * navigator.clipboard can silently fail in Electron - the promise resolves but
 * nothing is written to the system clipboard. These helpers use Electron's
 * native clipboard module via IPC when available, falling back to the web API
 * for non-Electron contexts.
 */
export declare function copyToClipboard(text: string): Promise<void>;
export declare function copyImageToClipboard(options: {
    src: string;
    filePath?: string;
}): Promise<void>;
export declare function readClipboard(): Promise<string>;
