/**
 * Gathers the facts {@link decidePendingTagFate} needs, applies its verdict,
 * and reports what it did.
 *
 * This is the read-path half of #1403. It runs on the renderer-facing IPC only
 * (`history:get-pending-tags`, `history:get-diff-baseline`), never on the
 * main-process paths that AI providers use while an edit is in flight — those
 * call `historyManager.getPendingTags` directly and must keep seeing the raw
 * row.
 *
 * Retiring flips `metadata.status` to `reviewed`; the row and its compressed
 * baseline stay in `document_history`. Nothing here deletes.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { HistoryManager, HistoryTag } from '../HistoryManager';
import { findGitRootForFile } from '../services/GitStatusService';
import { getCachedTrackedFiles, getCachedUncommittedFiles } from '../utils/gitUncommittedFiles';
import { isSessionSubscribedAnywhere } from '../file/WorkspaceEventBus';
import { logger } from '../utils/logger';
import {
  decidePendingTagFate,
  PENDING_TAG_RECONCILE_GRACE_MS,
  type PendingTagFateReason,
} from './pendingTagReconcile';

/**
 * Don't read a file into memory just to compare it with a baseline past this
 * size. A pending tag on something this large is vanishingly rare, and the
 * fallback (no disk content -> `keep`) is the safe direction.
 */
const MAX_DISK_COMPARE_BYTES = 10 * 1024 * 1024;

/** Git facts for one path, or nulls when git could not answer. */
interface GitFacts {
  isTracked: boolean | null;
  isUncommitted: boolean | null;
}

const UNKNOWN_GIT_FACTS: GitFacts = { isTracked: null, isUncommitted: null };

async function getGitFacts(filePath: string): Promise<GitFacts> {
  // The repo that owns a file is its nearest `.git` ancestor — which is also
  // correct inside a worktree, where `.git` is a file rather than a directory.
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
    logger.main.debug('[pendingTagReconciler] Git facts unavailable:', { filePath, error });
    return UNKNOWN_GIT_FACTS;
  }
}

function readDiskContent(filePath: string): { fileExists: boolean; diskContent: string | null } {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return { fileExists: false, diskContent: null };
    if (stat.size > MAX_DISK_COMPARE_BYTES) return { fileExists: true, diskContent: null };
    return { fileExists: true, diskContent: fs.readFileSync(filePath, 'utf-8') };
  } catch (error: any) {
    if (error?.code === 'ENOENT') return { fileExists: false, diskContent: null };
    // Unreadable for some other reason (permissions, a device node). Don't
    // conclude anything from that.
    return { fileExists: true, diskContent: null };
  }
}

/**
 * Reconcile the pending tags for one file and return the ones that survive.
 *
 * Takes the manager rather than the module singleton: `HistoryHandlers`
 * constructs its own `HistoryManager`, and retiring through a different
 * instance would leave that one's `pendingFilesCache` serving the tag it just
 * dropped.
 *
 * Retirements are logged with their reason so the distribution is visible in
 * `main.log` — the observability the destructive-paths rule asks for, and the
 * only way a later session can tell whether this is firing at all.
 */
export async function reconcilePendingTagsForFile(
  manager: HistoryManager,
  filePath: string,
): Promise<HistoryTag[]> {
  const tags = await manager.getPendingTags(filePath);
  if (tags.length === 0) return tags;

  const { fileExists, diskContent } = readDiskContent(filePath);

  // Only pay for git when content alone can't settle it. Every surviving tag
  // here already differs from disk, which is the case the git signal exists for.
  const needsGit = tags.some((tag) => diskContent === null || tag.content !== diskContent);
  const gitFacts = fileExists && needsGit ? await getGitFacts(filePath) : UNKNOWN_GIT_FACTS;

  const now = Date.now();
  const survivors: HistoryTag[] = [];
  const retired: Array<{ tagId: string; reason: PendingTagFateReason }> = [];

  for (const tag of tags) {
    const createdAt = tag.createdAt?.getTime?.();
    // A tag with no usable timestamp reads as brand new, so the grace guard
    // keeps it. Never judge a tag we can't date.
    const ageMs = Number.isFinite(createdAt) ? now - (createdAt as number) : 0;

    const fate = decidePendingTagFate({
      baseline: tag.content,
      diskContent,
      fileExists,
      isTracked: gitFacts.isTracked,
      isUncommitted: gitFacts.isUncommitted,
      ageMs,
      sessionIsActive: tag.sessionId ? isSessionSubscribedAnywhere(tag.sessionId) : false,
      graceMs: PENDING_TAG_RECONCILE_GRACE_MS,
    });

    if (fate.action === 'keep') {
      survivors.push(tag);
      continue;
    }

    try {
      await manager.updateTagStatus(filePath, tag.id, 'reviewed');
      retired.push({ tagId: tag.id, reason: fate.reason });
    } catch (error) {
      // Failing to retire is harmless — the tag stays pending and we try again
      // on the next read. Keep showing it rather than hiding a live diff.
      logger.main.warn('[pendingTagReconciler] Failed to retire pending tag:', {
        filePath,
        tagId: tag.id,
        reason: fate.reason,
        error,
      });
      survivors.push(tag);
    }
  }

  if (retired.length > 0) {
    logger.main.info('[pendingTagReconciler] Retired stale pending tags:', {
      filePath,
      count: retired.length,
      reasons: retired.map((r) => r.reason),
    });
  }

  return survivors;
}
