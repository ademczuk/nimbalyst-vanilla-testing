/**
 * Resolve a human folder path ("A/B") to a shared-folder id, creating the
 * segments that do not exist yet.
 *
 * Two callers need exactly this walk and neither can own it: the shared-index
 * MCP listeners (an agent naming a destination in prose) and the folder promote
 * flow (mirroring a local subfolder tree into the team's). Both must reuse an
 * existing folder rather than add a second one with the same name, and both
 * must re-read the folder atom between creations because `createSharedFolder`
 * is what puts the new row there.
 */

import { store } from "@nimbalyst/runtime/store";

import type { CollabScope } from "@nimbalyst/collab-client/core";

import {
  createSharedFolder,
  sharedFoldersAtom,
} from "../store/atoms/collabDocuments";

/**
 * Walk `segments` from `parentFolderId`, creating any that are missing.
 * Returns the id of the deepest segment, or `parentFolderId` when there are none.
 */
export async function ensureSharedFolderSegments(
  scope: CollabScope,
  segments: readonly string[],
  parentFolderId: string | null = null
): Promise<string | null> {
  let currentParentId = parentFolderId;
  for (const segment of segments) {
    const name = segment.trim();
    if (!name) continue;
    const folders = store.get(sharedFoldersAtom);
    const existing = folders.find(
      (folder) =>
        (folder.parentFolderId ?? null) === currentParentId &&
        folder.name === name
    );
    currentParentId = existing
      ? existing.folderId
      : await createSharedFolder(scope, name, currentParentId);
  }
  return currentParentId;
}

/**
 * Resolve a slash-separated folder path to a folder id. A blank path is the
 * team root (`null`).
 */
export async function resolveSharedFolderPath(
  scope: CollabScope,
  folderPath: string | undefined,
  parentFolderId: string | null = null
): Promise<string | null> {
  const segments = (folderPath ?? "")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) return parentFolderId;
  return ensureSharedFolderSegments(scope, segments, parentFolderId);
}
