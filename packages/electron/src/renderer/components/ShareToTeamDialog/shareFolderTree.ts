/**
 * The team-files folder tree, as a folder picker needs it.
 *
 * Split out of `ShareToTeamDialog` so the pure shape can be tested, and used,
 * without importing a dialog. `flattenCollabFolderOptions` returns a depth-
 * tagged flat list; a picker needs real nesting plus a path per node, because a
 * folder id is what gets stored and a path is what a human reads.
 */

import type { SharedFolder } from '../../store/atoms/collabDocuments';
import { flattenCollabFolderOptions, normalizeCollabPath } from '../CollabMode/collabTree';

export interface ShareFolderNode {
  folderId: string;
  path: string;
  name: string;
  depth: number;
  children: ShareFolderNode[];
}

/** Build the picker tree from authoritative first-class folder rows. */
export function buildShareFolderTree(folders: SharedFolder[]): ShareFolderNode[] {
  const options = flattenCollabFolderOptions(folders).filter(option => option.folderId !== null);
  const roots: ShareFolderNode[] = [];
  const stack: ShareFolderNode[] = [];
  const pathSegments: string[] = [];

  for (const option of options) {
    const folderId = option.folderId as string;
    stack.length = option.depth;
    pathSegments.length = option.depth;
    pathSegments[option.depth] = option.name;
    const node: ShareFolderNode = {
      folderId,
      path: normalizeCollabPath(pathSegments.join('/')),
      name: option.name,
      depth: option.depth,
      children: [],
    };
    const parent = option.depth > 0 ? stack[option.depth - 1] : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
    stack[option.depth] = node;
  }
  return roots;
}
