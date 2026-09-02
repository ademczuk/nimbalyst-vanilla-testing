/**
 * "Is this one file tracked, and does it differ from HEAD?" — resolved against
 * the repo that actually owns the file.
 *
 * Extracted because two callers need the same answer and only one of them had
 * it right. A project can span several folders, and a folder can be a container
 * holding several checkouts, so the repo for a file is not the workspace root
 * and cannot be derived from it. Anything that relativizes a path against
 * `workspacePath` before asking git is wrong the moment the file lives under an
 * attached folder.
 *
 * Every uncertainty answers `null`. Absence of evidence is never evidence that
 * an edit landed — callers use these facts to retire a pending review, and a
 * wrong `true` silently discards a diff the user never saw.
 */
import * as path from 'path';
import { findGitRootForFile } from '../services/GitStatusService';
import { getCachedTrackedFiles, getCachedUncommittedFiles } from '../utils/gitUncommittedFiles';
import { logger } from '../utils/logger';

/** Git facts for one path, or nulls when git could not answer. */
export interface FileGitFacts {
  isTracked: boolean | null;
  isUncommitted: boolean | null;
}

export const UNKNOWN_GIT_FACTS: FileGitFacts = { isTracked: null, isUncommitted: null };

export async function getGitFactsForFile(filePath: string): Promise<FileGitFacts> {
  // The repo that owns a file is its nearest `.git` ancestor — which is also
  // correct inside a worktree, where `.git` is a file rather than a directory,
  // and inside an attached folder, which has no workspace root of its own.
  const repoRoot = findGitRootForFile(filePath, path.parse(filePath).root);
  if (!repoRoot) return UNKNOWN_GIT_FACTS;

  try {
    const [tracked, uncommitted] = await Promise.all([
      getCachedTrackedFiles(repoRoot),
      getCachedUncommittedFiles(repoRoot),
    ]);

    // An empty tracked set means the listing failed or this is not a repo, not
    // that nothing is tracked. Treat it as no signal.
    if (tracked.size === 0) return UNKNOWN_GIT_FACTS;

    // git speaks forward slashes on every platform.
    const relative = path.relative(repoRoot, filePath).split(path.sep).join('/');

    return {
      isTracked: tracked.has(relative),
      isUncommitted: uncommitted.has(relative),
    };
  } catch (error) {
    // A timed-out or failed git call is not evidence the edit landed.
    logger.main.debug('[fileGitFacts] Git facts unavailable:', { filePath, error });
    return UNKNOWN_GIT_FACTS;
  }
}
