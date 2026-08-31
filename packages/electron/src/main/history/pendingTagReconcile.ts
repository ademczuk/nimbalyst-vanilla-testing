/**
 * Decide whether a pending-review tag still describes a diff worth reviewing.
 *
 * A pending tag is the baseline every red/green AI diff renders against. It is
 * stored once, keyed by absolute path, and until #1403 nothing ever checked it
 * again — so tags outlived the edits they described by months (3,284 rows on
 * one dev machine, oldest three months old), and files that git reported clean
 * still opened with a diff bar.
 *
 * `document_history` holds the ONLY copy of a pre-edit baseline; there is no
 * server-side copy. That makes this a destructive-data decision under
 * `.claude/rules/destructive-data-paths.md`, which is why it lives here as a
 * pure function over facts: the decision is testable without a git repo, a
 * database, or a live AI turn — the three environments that kept the original
 * leak invisible. Callers gather the facts; this decides; nothing here touches
 * disk or SQL.
 *
 * "Retire" means flipping `metadata.status` to `reviewed`. The row and its
 * compressed content survive — only the tag's claim on the UI is dropped.
 */

export type PendingTagFateAction = 'keep' | 'retire';

/**
 * Why a tag was kept or retired. Stable strings: they are logged as a
 * distribution so a later session can tell whether reconciliation is firing at
 * all, which is the observability #1347 went nine months without.
 */
export type PendingTagFateReason =
  | 'within-grace'
  | 'session-active'
  | 'file-missing'
  | 'baseline-matches-disk'
  | 'landed-in-git'
  | 'diff-still-pending';

export interface PendingTagFacts {
  /** Decompressed baseline content stored on the tag. */
  baseline: string;
  /** Current content on disk, or null when it could not be read. */
  diskContent: string | null;
  /** Whether the file exists on disk right now. */
  fileExists: boolean;
  /**
   * Whether git tracks this path. `null` means unknown — not a repo, git call
   * failed, or the caller did not ask. Absence of a tracked-file signal is NOT
   * evidence the file is untracked.
   */
  isTracked: boolean | null;
  /**
   * Whether the path appears in git's uncommitted set (modified, staged,
   * created, deleted, renamed, or untracked). `null` means unknown.
   */
  isUncommitted: boolean | null;
  /** Age of the tag in milliseconds. */
  ageMs: number;
  /**
   * Whether the tag's session is currently subscribed to the workspace, i.e.
   * an AI turn could still be in flight for it.
   */
  sessionIsActive: boolean;
  /**
   * Minimum tag age before any retire rule may fire. Guards the window between
   * `AgentToolHooks.tagFileBeforeEdit` writing a baseline and the tool actually
   * writing the file: in that window baseline === disk and the file is still
   * clean vs HEAD, so an unguarded rule would retire a live tag and the user's
   * diff would never appear. A tool-permission prompt can hold that window open
   * for minutes.
   */
  graceMs: number;
}

export interface PendingTagFate {
  action: PendingTagFateAction;
  reason: PendingTagFateReason;
}

/** Default grace period for reconciliation on a user-facing read path. */
export const PENDING_TAG_RECONCILE_GRACE_MS = 60_000;

/**
 * Pure decision: should this pending tag keep its claim on the UI?
 *
 * Rules are ordered so the two liveness guards run before any retire rule. A
 * fact that is unknown (`null`) never justifies retiring — absence of evidence
 * is not evidence the edit landed.
 */
export function decidePendingTagFate(facts: PendingTagFacts): PendingTagFate {
  // Liveness guards first. An edit that may still be in flight is never judged.
  if (facts.ageMs < facts.graceMs) {
    return { action: 'keep', reason: 'within-grace' };
  }
  if (facts.sessionIsActive) {
    return { action: 'keep', reason: 'session-active' };
  }

  // The file the baseline describes is gone. Nothing can diff against it.
  if (!facts.fileExists) {
    return { action: 'retire', reason: 'file-missing' };
  }

  // Baseline and disk agree, so there is no diff to show. This does not clear a
  // visible "N changes" bar (TabEditor only enters diff mode when the two
  // differ) but it does clear the tab dot and the Files-edited sidebar dot,
  // both of which count pending rows rather than comparing content.
  if (facts.diskContent !== null && facts.baseline === facts.diskContent) {
    return { action: 'retire', reason: 'baseline-matches-disk' };
  }

  // The edit landed: git tracks the path and reports nothing uncommitted for
  // it, so what is on disk is what is in HEAD. Whether the edit was committed
  // or discarded with `git checkout --`, the stored baseline describes a diff
  // that no longer exists.
  //
  // BOTH signals are required. A path missing from the uncommitted set means
  // "tracked and clean" OR "gitignored", and retiring on that alone would
  // silently drop every legitimate pending review under a gitignored directory.
  if (facts.isTracked === true && facts.isUncommitted === false) {
    return { action: 'retire', reason: 'landed-in-git' };
  }

  return { action: 'keep', reason: 'diff-still-pending' };
}
