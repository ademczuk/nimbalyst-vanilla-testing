// @vitest-environment node
/**
 * The retire decision for a pending-review tag. `document_history` holds the
 * only copy of a pre-edit baseline, so every rule that drops one is pinned
 * here — including the two liveness guards, which exist because
 * `AgentToolHooks.tagFileBeforeEdit` writes a baseline equal to current disk
 * content BEFORE the tool writes the file. Without the guards, reconciliation
 * retires a live tag during that window and the user's diff never appears
 * (#1403).
 */
import { describe, expect, it } from 'vitest';
import {
  decidePendingTagFate,
  PENDING_TAG_RECONCILE_GRACE_MS,
  type PendingTagFacts,
} from '../pendingTagReconcile';

/** A tag old enough to judge, whose baseline genuinely differs from disk. */
function facts(overrides: Partial<PendingTagFacts> = {}): PendingTagFacts {
  return {
    baseline: 'before',
    diskContent: 'after',
    fileExists: true,
    isTracked: null,
    isUncommitted: null,
    ageMs: PENDING_TAG_RECONCILE_GRACE_MS * 2,
    sessionIsActive: false,
    graceMs: PENDING_TAG_RECONCILE_GRACE_MS,
    ...overrides,
  };
}

describe('decidePendingTagFate', () => {
  it('keeps a real pending diff', () => {
    expect(decidePendingTagFate(facts())).toEqual({
      action: 'keep',
      reason: 'diff-still-pending',
    });
  });

  describe('liveness guards run before every retire rule', () => {
    // The pre-edit window: baseline was captured from disk moments ago, the
    // tool has not written yet, and the file is still clean vs HEAD. Every
    // retire rule would otherwise fire on this exact shape.
    const liveEdit = {
      baseline: 'current',
      diskContent: 'current',
      fileExists: true,
      isTracked: true,
      isUncommitted: false,
    };

    it('keeps a tag younger than the grace period', () => {
      expect(decidePendingTagFate(facts({ ...liveEdit, ageMs: 5_000 }))).toEqual({
        action: 'keep',
        reason: 'within-grace',
      });
    });

    it('keeps a tag whose session is still subscribed, however old', () => {
      expect(
        decidePendingTagFate(
          facts({ ...liveEdit, ageMs: 86_400_000, sessionIsActive: true }),
        ),
      ).toEqual({ action: 'keep', reason: 'session-active' });
    });
  });

  it('retires a tag whose file no longer exists', () => {
    expect(
      decidePendingTagFate(facts({ fileExists: false, diskContent: null })),
    ).toEqual({ action: 'retire', reason: 'file-missing' });
  });

  it('retires a tag whose baseline matches disk', () => {
    expect(
      decidePendingTagFate(facts({ baseline: 'same', diskContent: 'same' })),
    ).toEqual({ action: 'retire', reason: 'baseline-matches-disk' });
  });

  it('retires a tracked file with nothing uncommitted — the edit landed', () => {
    expect(
      decidePendingTagFate(facts({ isTracked: true, isUncommitted: false })),
    ).toEqual({ action: 'retire', reason: 'landed-in-git' });
  });

  describe('never retires on absence of evidence', () => {
    // A gitignored path is absent from the uncommitted set for the same reason
    // a clean tracked path is. Retiring on that alone would drop every pending
    // review under nimbalyst-local/ or temptests/.
    it('keeps a gitignored file that is not in the uncommitted set', () => {
      expect(
        decidePendingTagFate(facts({ isTracked: false, isUncommitted: false })),
      ).toEqual({ action: 'keep', reason: 'diff-still-pending' });
    });

    it('keeps a file whose tracked state is unknown', () => {
      expect(
        decidePendingTagFate(facts({ isTracked: null, isUncommitted: false })),
      ).toEqual({ action: 'keep', reason: 'diff-still-pending' });
    });

    it('keeps a tracked file whose uncommitted state is unknown', () => {
      expect(
        decidePendingTagFate(facts({ isTracked: true, isUncommitted: null })),
      ).toEqual({ action: 'keep', reason: 'diff-still-pending' });
    });

    it('keeps a tracked file that still has uncommitted changes', () => {
      expect(
        decidePendingTagFate(facts({ isTracked: true, isUncommitted: true })),
      ).toEqual({ action: 'keep', reason: 'diff-still-pending' });
    });

    it('keeps a tag whose disk content could not be read', () => {
      expect(decidePendingTagFate(facts({ diskContent: null }))).toEqual({
        action: 'keep',
        reason: 'diff-still-pending',
      });
    });
  });
});
