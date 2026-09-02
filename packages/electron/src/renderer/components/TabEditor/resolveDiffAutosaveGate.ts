/**
 * Whether an autosave may run while an AI edit is pending review.
 *
 * This is the decision half of `TabEditor.settleDiffBeforeAutosave`, extracted so
 * it can be exercised without an editor. The incident behind NIM-5359 is exactly
 * this decision going wrong: the mount path entered diff mode without giving the
 * model any disk truth, the gate found no diff nodes, marked the tag reviewed and
 * returned "proceed" -- and the autosave serialized the pre-edit buffer over
 * thirty minutes of agent writes as a clean, conflict-check-passing save.
 *
 * The rule that makes that impossible: **"no inline diff" is not the same as
 * "manually resolved."** Only a generation that verifiably rendered inline and
 * was then reduced to zero groups by the user may end review. Everything else --
 * a deliberate large-document fallback, a failed apply, source mode, or a model
 * that cannot say what disk holds -- blocks the write.
 *
 * `TabEditor.settleDiffBeforeAutosave` produces the inputs: `presentation` is the
 * outcome it last reported for the generation the model currently holds, and
 * `resolutionInFlight` is the model's live resolution mutex -- not its retained
 * snapshot, which survives a failed attempt and would block autosave forever.
 * The tests in `__tests__/resolveDiffAutosaveGate.test.ts` are the contract.
 */

/** How the pending generation is currently being presented to the user. */
export type DiffPresentationMode =
  /** No generation is being presented. */
  | 'none'
  /** Inline diff nodes were rendered and verified for this generation. */
  | 'inline'
  /**
   * Deliberately no inline diff (large-document fallback). The buffer holds the
   * agent's content and the approval bar is still pending -- zero diff nodes here
   * means "never rendered", not "resolved".
   */
  | 'presented-without-inline'
  /** Source mode is active: this attachment is not a presenter at all. */
  | 'source-deferred'
  /** The apply threw, or its readback could not be verified. */
  | 'failed';

export interface DiffAutosaveGateInput {
  /** This tab is tracking a pending AI-edit tag. */
  hasPendingTag: boolean;
  /** A diff resolution is already in flight; never race it. */
  resolutionInFlight: boolean;
  presentation: DiffPresentationMode;
  /**
   * Whether the editor still holds diff nodes. `null` when no editor is
   * available to read (a custom editor, or an editor that has not mounted).
   */
  hasDiffNodes: boolean | null;
  /**
   * What the model says disk holds for the pending generation
   * (`DiffState.newContent`). `null` when the model has no diff state -- which is
   * the mount-path hole: entering diff mode without telling the model means
   * nothing can re-anchor the baseline before the write.
   */
  modelDiskContent: string | null;
}

export type DiffAutosaveSkipReason =
  | 'resolution-in-flight'
  | 'diff-nodes-present'
  | 'unreadable-editor'
  | 'no-model-disk-truth'
  | 'source-deferred'
  | 'presented-without-inline'
  | 'presentation-failed';

export type DiffAutosaveGateDecision =
  /** No pending review is in the way; autosave as normal. */
  | { kind: 'proceed' }
  /** Hold the write. The dirty buffer stays intact. */
  | { kind: 'skip'; reason: DiffAutosaveSkipReason }
  /**
   * The user resolved every group by hand. Adopt `adoptedBaseline` as the tab's
   * and the model's baseline, end the review through the model's awaited
   * resolution, then let the write through.
   */
  | { kind: 'settle'; adoptedBaseline: string | null };

export function resolveDiffAutosaveGate(
  input: DiffAutosaveGateInput,
): DiffAutosaveGateDecision {
  if (input.resolutionInFlight) {
    return { kind: 'skip', reason: 'resolution-in-flight' };
  }

  if (!input.hasPendingTag) {
    return { kind: 'proceed' };
  }

  // How the generation was presented decides what zero diff nodes means. Only
  // `inline` ever renders them, so only `inline` can lose them by being resolved.
  switch (input.presentation) {
    case 'source-deferred':
      return { kind: 'skip', reason: 'source-deferred' };
    case 'presented-without-inline':
      return { kind: 'skip', reason: 'presented-without-inline' };
    case 'failed':
      return { kind: 'skip', reason: 'presentation-failed' };
    default:
      break;
  }

  // No editor to read means no evidence either way -- the same unverified
  // baseline shape `reloadFromDisk.ts` names as destructive.
  if (input.hasDiffNodes === null) {
    return { kind: 'skip', reason: 'unreadable-editor' };
  }

  if (input.hasDiffNodes) {
    return { kind: 'skip', reason: 'diff-nodes-present' };
  }

  // An inline generation the user reduced to zero groups by hand. Ending the
  // review is only safe if the model can name the bytes the tab must adopt as
  // its baseline first; without them the write compares the agent's content
  // against itself and the revert lands as a clean save.
  if (input.modelDiskContent === null) {
    return { kind: 'skip', reason: 'no-model-disk-truth' };
  }

  return { kind: 'settle', adoptedBaseline: input.modelDiskContent };
}

// -- Manual save (Cmd+S) while a review is open ------------------------------

export interface ManualSaveReviewGateInput {
  /** This tab is tracking a pending AI-edit tag. */
  hasPendingTag: boolean;
  /** A diff resolution owns the decision, or wrote bytes it has not finished. */
  resolutionInFlight: boolean;
  /** The model wrote resolved bytes but has not marked the tag reviewed. */
  resolutionIncomplete: boolean;
  /**
   * An apply is still moving the buffer. During that window the buffer holds the
   * *baseline*, not the user's document.
   */
  applyInFlight: boolean;
  presentation: DiffPresentationMode;
}

export type ManualSaveRefusalReason =
  | 'resolution-in-flight'
  | 'resolution-incomplete'
  | 'apply-in-flight'
  | 'presentation-unverified';

export type ManualSaveReviewDecision =
  /** No review is in the way; save normally. */
  | { kind: 'save' }
  /**
   * The user is looking at a verified inline diff. Accept it through the model's
   * awaited resolution first, then save.
   */
  | { kind: 'resolve-then-save' }
  /** Hold everything. The buffer is preserved and the review stays open. */
  | { kind: 'refuse'; reason: ManualSaveRefusalReason };

/**
 * Whether Cmd+S may write while an AI edit is pending review.
 *
 * The incident this closes: manual save used to approve whatever diff nodes it
 * found (none, if an apply was mid-flight), clear the model's diff state, fire a
 * tag update it never awaited, and write the buffer. Inside the ~350ms an apply
 * spends with the buffer reset to the pre-edit baseline, that write was the
 * baseline -- and because the tab's conflict baseline had just been set from the
 * agent's content on reopen, it passed the conflict check byte for byte. That is
 * the NIM-5359 incident reachable from one keystroke.
 *
 * So the only shape that may resolve-and-save is a generation this tab
 * verifiably rendered inline and that is no longer moving. Everything else --
 * source mode, a large-document fallback with its own approval bar, a failed
 * apply, an apply in flight -- refuses and leaves the review open.
 */
export function resolveManualSaveReviewGate(
  input: ManualSaveReviewGateInput,
): ManualSaveReviewDecision {
  if (input.resolutionIncomplete) {
    return { kind: 'refuse', reason: 'resolution-incomplete' };
  }
  if (!input.hasPendingTag) {
    return { kind: 'save' };
  }
  if (input.resolutionInFlight) {
    return { kind: 'refuse', reason: 'resolution-in-flight' };
  }
  if (input.applyInFlight) {
    return { kind: 'refuse', reason: 'apply-in-flight' };
  }
  if (input.presentation !== 'inline') {
    return { kind: 'refuse', reason: 'presentation-unverified' };
  }
  return { kind: 'resolve-then-save' };
}
