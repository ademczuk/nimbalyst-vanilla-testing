/**
 * How a folder promote is ordered, and how its outcome is described.
 *
 * Both are pure, and both are the parts most likely to be wrong in a way the
 * author cannot see: an ordering bug publishes a second copy of a document that
 * is already in the batch, and a summary bug lets a promote that dropped six
 * files read as "shared". Neither needs a collab scope to decide, so they live
 * here where a test can reach them without standing up a room.
 */

import type { FolderShareCandidate } from "./folderShareCandidates";

/**
 * Share the files that embed nothing in this batch first, so an embedder always
 * finds its target already published. Depth-first with a visiting set: a cycle
 * stops recursing and both files keep their input order, which costs one local
 * link rather than duplicating a document.
 */
export function orderCandidatesByEmbedDependency(
  candidates: readonly FolderShareCandidate[],
  dependenciesByRelativePath: ReadonlyMap<string, ReadonlySet<string>>
): FolderShareCandidate[] {
  const byRelativePath = new Map(
    candidates.map((candidate) => [candidate.relativePath, candidate])
  );
  const ordered: FolderShareCandidate[] = [];
  const done = new Set<string>();
  const visiting = new Set<string>();

  const visit = (relativePath: string): void => {
    if (done.has(relativePath) || visiting.has(relativePath)) return;
    const candidate = byRelativePath.get(relativePath);
    if (!candidate) return;
    visiting.add(relativePath);
    for (const dependency of dependenciesByRelativePath.get(relativePath) ?? []) {
      visit(dependency);
    }
    visiting.delete(relativePath);
    done.add(relativePath);
    ordered.push(candidate);
  };

  for (const candidate of candidates) visit(candidate.relativePath);
  return ordered;
}

type NotifyFn = (
  title: string,
  message: string,
  options?: { details?: string; duration?: number }
) => void;

/**
 * One notification for the whole promote. Exported so the wording of a partial
 * outcome -- the case an author is most likely to misread as "all of it worked"
 * -- can be asserted without a live collab scope.
 */
export function reportFolderShareOutcome(input: {
  folderName: string;
  sharedFolderPath: string;
  sharedCount: number;
  skippedCount: number;
  failures: ReadonlyArray<{ relativePath: string; error: string }>;
  warnings: readonly string[];
  skipped: ReadonlyArray<{ relativePath: string; reason: string }>;
  showError: NotifyFn;
  showWarning: NotifyFn;
  showInfo: NotifyFn;
}): void {
  const details = [
    ...input.failures.map((failure) => `${failure.relativePath}: ${failure.error}`),
    ...input.skipped.map((file) => `${file.relativePath}: ${file.reason}`),
    ...input.warnings,
  ].join("\n");
  const destination = input.sharedFolderPath || "the team root";

  if (input.sharedCount === 0) {
    input.showError(
      "Nothing was shared",
      input.failures.length > 0
        ? `No document in "${input.folderName}" could be shared.`
        : `No file in "${input.folderName}" has a collaborative document type.`,
      { details: details || undefined, duration: 10000 }
    );
    return;
  }

  const documentLabel = `${input.sharedCount} document${
    input.sharedCount === 1 ? "" : "s"
  }`;
  const leftovers: string[] = [];
  if (input.failures.length > 0) {
    leftovers.push(
      `${input.failures.length} failed to share`
    );
  }
  if (input.skippedCount > 0) {
    leftovers.push(
      `${input.skippedCount} file${
        input.skippedCount === 1 ? "" : "s"
      } had no collaborative document type`
    );
  }

  if (leftovers.length === 0 && input.warnings.length === 0) {
    input.showInfo(
      "Folder shared to team",
      `Shared ${documentLabel} from "${input.folderName}" to ${destination}.`,
      { duration: 5000 }
    );
    return;
  }

  input.showWarning(
    "Folder shared with exceptions",
    `Shared ${documentLabel} from "${input.folderName}" to ${destination}. ${[
      ...leftovers,
      ...input.warnings,
    ].join("; ")}.`,
    { details: details || undefined, duration: 10000 }
  );
}
