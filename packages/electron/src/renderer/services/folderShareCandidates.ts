/**
 * Which files inside a local folder can become collaborative documents.
 *
 * Kept pure and separate from the flow that publishes them because the two
 * questions have different failure modes and only one of them is cheap to test.
 * "Did we pick the right files, mirror the right subfolders, and account for
 * every file we skipped?" is arithmetic over a list of names; "did the team
 * actually receive them?" needs a live collab scope. Splitting them means the
 * arithmetic is covered without standing up a room.
 *
 * The `skipped` list is not a diagnostic afterthought. A folder promote that
 * quietly publishes 9 of 15 files reads as "shared" to the author, so the
 * summary has to be able to name the other six and why.
 */

import type { CollaborativeDocumentTypeDescriptor } from "./CollaborativeDocumentTypeCatalog";

/**
 * The most documents one folder promote will publish.
 *
 * The bound that matters is documents, not files scanned: reading 3000 names off
 * disk is nothing, while every eligible file becomes a real collaborative
 * document the whole team then sees. Past this the promote is refused rather
 * than truncated -- a half-published folder looks complete to everyone but the
 * author, and undoing it means trashing the documents one at a time. Promoting
 * subfolders separately is the way through.
 */
export const MAX_FOLDER_SHARE_DOCUMENTS = 100;

export interface FolderShareCandidate {
  /** Folder-relative POSIX path, e.g. `design/login.mockup.html`. */
  relativePath: string;
  fileName: string;
  /** Folder-relative POSIX path of the parent, `""` for the folder root. */
  parentRelativePath: string;
  descriptor: CollaborativeDocumentTypeDescriptor;
}

export interface FolderShareSkippedFile {
  relativePath: string;
  fileName: string;
  reason: string;
}

export interface FolderShareCandidateSet {
  candidates: FolderShareCandidate[];
  skipped: FolderShareSkippedFile[];
  /**
   * Every folder-relative subfolder path that holds at least one candidate,
   * parents before children. Folders with nothing shareable in them are absent:
   * mirroring them would add empty folders to the team tree that nobody asked
   * for and nobody can fill from here.
   */
  subfolderPaths: string[];
}

export type ShareDescriptorResolver = (
  fileName: string
) =>
  | { ok: true; descriptor: CollaborativeDocumentTypeDescriptor }
  | { ok: false; reason: string };

function splitRelativePath(relativePath: string): {
  parentRelativePath: string;
  fileName: string;
} {
  const lastSlash = relativePath.lastIndexOf("/");
  return lastSlash === -1
    ? { parentRelativePath: "", fileName: relativePath }
    : {
        parentRelativePath: relativePath.slice(0, lastSlash),
        fileName: relativePath.slice(lastSlash + 1),
      };
}

export function collectFolderShareCandidates(
  relativeFilePaths: readonly string[],
  resolveDescriptor: ShareDescriptorResolver
): FolderShareCandidateSet {
  const candidates: FolderShareCandidate[] = [];
  const skipped: FolderShareSkippedFile[] = [];

  for (const relativePath of relativeFilePaths) {
    const { parentRelativePath, fileName } = splitRelativePath(relativePath);
    const resolved = resolveDescriptor(fileName);
    if (resolved.ok) {
      candidates.push({
        relativePath,
        fileName,
        parentRelativePath,
        descriptor: resolved.descriptor,
      });
    } else {
      skipped.push({ relativePath, fileName, reason: resolved.reason });
    }
  }

  // Every ancestor of a candidate's folder needs to exist before the folder
  // itself does, so expand each parent into its own chain and emit shortest
  // first. A Set keeps the shared prefixes from being created twice.
  const subfolders = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate.parentRelativePath) continue;
    const segments = candidate.parentRelativePath.split("/");
    for (let index = 0; index < segments.length; index += 1) {
      subfolders.add(segments.slice(0, index + 1).join("/"));
    }
  }

  return {
    candidates,
    skipped,
    subfolderPaths: [...subfolders].sort(
      (left, right) =>
        left.split("/").length - right.split("/").length ||
        left.localeCompare(right)
    ),
  };
}
