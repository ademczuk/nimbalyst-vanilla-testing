/**
 * Filesystem access for embedded editors, in a document or on a canvas.
 *
 * Lifted verbatim out of `EmbedFrame` when the Project Canvas needed the same
 * four operations. They look trivial enough to retype, which is exactly the
 * hazard: `readFileFromDisk`'s three failure shapes (missing IPC, `null` for a
 * file that is not there, `{success:false}` for one that could not be read) all
 * have to become throws or the extension mounts against `undefined`, and
 * `writeFileToDisk` has to route through `assertFileSaveSucceeded` or a rejected
 * save reads as a successful one and the dirty flag clears over unsaved work.
 *
 * No React, no atoms: callers own subscription and dedup.
 */

import { isAbsolute, join } from 'pathe';

import { assertFileSaveSucceeded } from '../../utils/fileSaveResult';

type ReadFileResult =
  | null
  | { success: true; content: string; isBinary: boolean; detectedEncoding?: string }
  | { success: false; error: string };

function workspacePath(): string | undefined {
  return (window as unknown as { __workspacePath?: string }).__workspacePath;
}

export async function readFileFromDisk(absolutePath: string): Promise<string> {
  const api = (window as unknown as {
    electronAPI?: {
      readFileContent?: (
        path: string,
        opts?: { binary?: boolean },
      ) => Promise<ReadFileResult>;
    };
  }).electronAPI;
  if (!api?.readFileContent) {
    throw new Error('readFileContent IPC not available');
  }
  const result = await api.readFileContent(absolutePath);
  // null = file missing on disk (or virtual:// stub).
  if (!result) {
    throw new Error(`File not found: ${absolutePath}`);
  }
  if (result.success === false) {
    throw new Error(result.error || `Failed to read ${absolutePath}`);
  }
  return result.content;
}

export async function writeFileToDisk(
  absolutePath: string,
  content: string | ArrayBuffer,
): Promise<void> {
  const api = (window as unknown as {
    electronAPI?: {
      saveFile?: (
        content: string,
        filePath: string,
        lastKnownContent?: string,
        saveSource?: 'auto' | 'manual',
      ) => Promise<{
        success: boolean;
        conflict?: boolean;
        deleted?: boolean;
        errorType?: string;
        errorCode?: string;
      } | null>;
    };
  }).electronAPI;
  if (!api?.saveFile) throw new Error('saveFile IPC not available');
  const text =
    typeof content === 'string'
      ? content
      : new TextDecoder().decode(content);
  const result = await api.saveFile(text, absolutePath, undefined, 'auto');
  assertFileSaveSucceeded(result);
}

export function workspaceRelativePath(absolutePath: string): string {
  const root = workspacePath();
  if (!root) return absolutePath;
  if (absolutePath.startsWith(root)) {
    const rest = absolutePath.slice(root.length);
    return rest.replace(/^[/\\]/, '');
  }
  return absolutePath;
}

/** A workspace-relative (or already absolute) path, resolved against the root. */
export function workspaceAbsolutePath(path: string): string | null {
  if (!path) return null;
  const stripped = path.replace(/^file:\/\//i, '');
  if (isAbsolute(stripped)) return stripped;
  const root = workspacePath();
  return root ? join(root, stripped) : null;
}

export function openFileInTab(absolutePath: string): void {
  const root = workspacePath();
  if (!root) {
    console.error('[EmbedFrame] __workspacePath not set -- cannot open embed in a tab');
    return;
  }
  const api = (window as unknown as {
    electronAPI?: {
      invoke?: (channel: string, payload: unknown) => Promise<unknown>;
    };
  }).electronAPI;
  if (!api?.invoke) return;
  api
    .invoke('workspace:open-file', { workspacePath: root, filePath: absolutePath })
    .catch((error: unknown) => {
      console.error('[EmbedFrame] Failed to open embed in tab:', error);
    });
}
