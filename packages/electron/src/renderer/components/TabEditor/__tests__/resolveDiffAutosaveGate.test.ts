// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  resolveDiffAutosaveGate,
  resolveManualSaveReviewGate,
  type DiffAutosaveGateInput,
  type ManualSaveReviewGateInput,
} from '../resolveDiffAutosaveGate';

/**
 * The decision table for NIM-5359 defect A.
 *
 * The incident: a plan file sat in diff mode for thirty minutes of agent writes,
 * the gate saw zero diff nodes, marked the tag reviewed, and let an autosave
 * serialize the pre-edit buffer. Disk held the agent's content, the tab's
 * baseline held the agent's content, so the conflict check compared agent
 * against agent and passed. Every row below that expects `skip` is a shape where
 * "zero diff nodes" does not mean "the user resolved this".
 */
function gateInput(overrides: Partial<DiffAutosaveGateInput> = {}): DiffAutosaveGateInput {
  return {
    hasPendingTag: true,
    resolutionInFlight: false,
    presentation: 'inline',
    hasDiffNodes: false,
    modelDiskContent: 'agent content',
    ...overrides,
  };
}

describe('resolveDiffAutosaveGate', () => {
  it('proceeds when no review is pending', () => {
    expect(resolveDiffAutosaveGate(gateInput({ hasPendingTag: false, presentation: 'none' })))
      .toEqual({ kind: 'proceed' });
  });

  it('never races a resolution that is already in flight', () => {
    expect(resolveDiffAutosaveGate(gateInput({ resolutionInFlight: true })))
      .toEqual({ kind: 'skip', reason: 'resolution-in-flight' });
  });

  it('blocks while diff nodes are still on screen', () => {
    expect(resolveDiffAutosaveGate(gateInput({ hasDiffNodes: true })))
      .toEqual({ kind: 'skip', reason: 'diff-nodes-present' });
  });

  it('settles a rendered inline diff the user reduced to zero groups, adopting the model baseline', () => {
    expect(resolveDiffAutosaveGate(gateInput({ modelDiskContent: 'agent content' })))
      .toEqual({ kind: 'settle', adoptedBaseline: 'agent content' });
  });

  /**
   * The incident row. The mount path entered diff mode without giving the model
   * any diff state, so there is no disk truth to re-anchor the baseline to.
   * Settling here is what turned an autosave into a thirty-minute revert.
   */
  it('blocks when the model cannot say what disk holds', () => {
    expect(resolveDiffAutosaveGate(gateInput({ modelDiskContent: null })))
      .toEqual({ kind: 'skip', reason: 'no-model-disk-truth' });
  });

  /**
   * Source mode renders no inline diff by design and is not a presenter. Zero
   * diff nodes there is the normal steady state, not a resolution.
   */
  it('blocks while source mode defers presentation', () => {
    expect(resolveDiffAutosaveGate(gateInput({ presentation: 'source-deferred' })))
      .toEqual({ kind: 'skip', reason: 'source-deferred' });
  });

  /**
   * Large-document fallback (#4821) intentionally renders zero diff nodes while
   * the approval bar stays pending. Treating that as "manually resolved" writes
   * whatever the buffer holds over the agent's content.
   */
  it('blocks the deliberate no-inline fallback', () => {
    expect(resolveDiffAutosaveGate(gateInput({ presentation: 'presented-without-inline' })))
      .toEqual({ kind: 'skip', reason: 'presented-without-inline' });
  });

  it('blocks a generation whose apply failed or could not be verified', () => {
    expect(resolveDiffAutosaveGate(gateInput({ presentation: 'failed' })))
      .toEqual({ kind: 'skip', reason: 'presentation-failed' });
  });

  /**
   * No editor to read means no evidence either way. The old code returned
   * 'proceed' here, which is the same unverified-baseline shape reloadFromDisk.ts
   * names as destructive.
   */
  it('blocks when the editor cannot be read for diff nodes', () => {
    expect(resolveDiffAutosaveGate(gateInput({ hasDiffNodes: null })))
      .toEqual({ kind: 'skip', reason: 'unreadable-editor' });
  });
});

/**
 * Cmd+S during a review. The autosave gate above never applied here: manual save
 * went straight to approving whatever was on screen and writing the buffer, so
 * the whole incident was reachable from one keystroke landing inside an apply
 * window.
 */
function manualSaveInput(
  overrides: Partial<ManualSaveReviewGateInput> = {},
): ManualSaveReviewGateInput {
  return {
    hasPendingTag: true,
    resolutionInFlight: false,
    resolutionIncomplete: false,
    applyInFlight: false,
    presentation: 'inline',
    ...overrides,
  };
}

describe('resolveManualSaveReviewGate', () => {
  it('saves normally when no review is pending', () => {
    expect(resolveManualSaveReviewGate(manualSaveInput({ hasPendingTag: false, presentation: 'none' })))
      .toEqual({ kind: 'save' });
  });

  it('accepts a verified inline diff through the model before writing', () => {
    expect(resolveManualSaveReviewGate(manualSaveInput())).toEqual({ kind: 'resolve-then-save' });
  });

  /**
   * The incident keystroke. An apply resets the buffer to the pre-edit baseline
   * and only dispatches the diff ~350ms later; a save in that window approves
   * nothing and writes the baseline over the agent's content, and the tab's own
   * conflict baseline (set from the agent's bytes on reopen) waves it through.
   */
  it('refuses while an apply still has the buffer', () => {
    expect(resolveManualSaveReviewGate(manualSaveInput({ applyInFlight: true })))
      .toEqual({ kind: 'refuse', reason: 'apply-in-flight' });
  });

  it('refuses a generation this tab never verifiably rendered', () => {
    for (const presentation of ['failed', 'none', 'source-deferred', 'presented-without-inline'] as const) {
      expect(resolveManualSaveReviewGate(manualSaveInput({ presentation })))
        .toEqual({ kind: 'refuse', reason: 'presentation-unverified' });
    }
  });

  it('never races a resolution that already owns the decision', () => {
    expect(resolveManualSaveReviewGate(manualSaveInput({ resolutionInFlight: true })))
      .toEqual({ kind: 'refuse', reason: 'resolution-in-flight' });
  });

  /**
   * Bytes are on disk under a tag that still reads as unreviewed. A second write
   * buries the half-finished transaction, so it is refused even with no pending
   * tag tracked locally.
   */
  it('refuses while a resolution has written but not finished', () => {
    expect(resolveManualSaveReviewGate(manualSaveInput({ hasPendingTag: false, resolutionIncomplete: true })))
      .toEqual({ kind: 'refuse', reason: 'resolution-incomplete' });
  });
});
