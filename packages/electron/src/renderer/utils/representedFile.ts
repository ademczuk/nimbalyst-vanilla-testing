import { isNonFilesystemTab } from '../contexts/TabsContext';

/**
 * #1375: Resolve which file the window's AXDocument should point at, given the
 * path of the document currently on screen.
 *
 * Returns null when there is nothing to represent -- no document, or one whose
 * path is a virtual/collab/tracker resource rather than a real file. Callers
 * pass null through to clear; `setRepresentedFilename` has no implicit clear.
 */
export function resolveRepresentedFile(
    activeFilePath: string | null | undefined,
): string | null {
    if (!activeFilePath) return null;

    return isNonFilesystemTab(activeFilePath) ? null : activeFilePath;
}
