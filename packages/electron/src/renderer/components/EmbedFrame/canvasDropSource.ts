/**
 * What the desktop lets you drag onto a project canvas.
 *
 * Both of the app's trees already drag something; neither was dragging it *for*
 * the canvas, so this reads what they happen to publish rather than asking them
 * to publish something new:
 *
 * - The workspace file tree writes an absolute path under
 *   `application/x-nimbalyst-file-mention` (the type the AI input reads to turn
 *   a drop into an `@` mention). A canvas reference is workspace-*relative*, so
 *   the path is rebased here -- a board that stored absolute paths would break
 *   the moment it was opened on another machine, which is the whole point of
 *   `.canvas` being a file that reviews as a diff.
 * - The shared-docs tree writes org + id + title under
 *   `application/x-nimbalyst-collab-document`. See `documentDrag.ts` for why
 *   its `text/plain` id alone is not enough.
 *
 * `accepts` is answerable from MIME types alone because that is all a
 * `dragover` gets -- see `CanvasDropSource`.
 */

import type { CanvasCardPick, CanvasDropSource } from '@nimbalyst/runtime/canvas';
import {
  COLLAB_DOCUMENT_DRAG_TYPE,
  parseCollabDocumentDrag,
} from '@nimbalyst/collab-client/docs-ui';

import { store } from '@nimbalyst/runtime/store';
import { activeWorkspacePathAtom } from '../../store/atoms/openProjects';

/** Written by `FlatFileTree`'s `onDragStart`; an absolute path. */
const FILE_MENTION_DRAG_TYPE = 'application/x-nimbalyst-file-mention';

/**
 * Rebase an absolute path onto the open workspace.
 *
 * Returns null for a path outside it. A card can only name something the
 * workspace can resolve, and quietly storing `../../../etc/hosts` as a
 * reference would produce a card that is broken everywhere except the machine
 * that made it.
 */
export function workspaceRelativeDropPath(
  absolutePath: string,
  workspacePath: string | null
): string | null {
  if (!absolutePath || !workspacePath) return null;
  // Windows separators, matching `isPathInsideWorkspace`'s tolerance.
  const prefixes = [`${workspacePath}/`, `${workspacePath}\\`];
  const prefix = prefixes.find((candidate) => absolutePath.startsWith(candidate));
  if (!prefix) return null;
  const relative = absolutePath.slice(prefix.length);
  return relative.length > 0 ? relative.replace(/\\/g, '/') : null;
}

function basenameOf(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

export function readCanvasDrop(
  dataTransfer: Pick<DataTransfer, 'getData'>,
  workspacePath: string | null
): CanvasCardPick | null {
  const shared = parseCollabDocumentDrag(
    dataTransfer.getData(COLLAB_DOCUMENT_DRAG_TYPE)
  );
  if (shared) {
    return {
      reference: {
        kind: 'doc',
        uri: `nimbalyst://doc/${encodeURIComponent(
          shared.orgId
        )}/${encodeURIComponent(shared.documentId)}`,
      },
      label: shared.title,
    };
  }

  const relative = workspaceRelativeDropPath(
    dataTransfer.getData(FILE_MENTION_DRAG_TYPE),
    workspacePath
  );
  if (relative === null) return null;
  return {
    reference: { kind: 'file', path: relative },
    label: basenameOf(relative),
  };
}

export const canvasDropSource: CanvasDropSource = {
  accepts: (types) =>
    types.includes(COLLAB_DOCUMENT_DRAG_TYPE) ||
    types.includes(FILE_MENTION_DRAG_TYPE),
  read: (dataTransfer) =>
    readCanvasDrop(dataTransfer, store.get(activeWorkspacePathAtom)),
};
