import type { SaveAttemptResult } from './resolveSaveAttempt';

/**
 * The write that ends a diff review (accept all, reject all, revert, partial).
 *
 * While a diff is pending, disk does not hold what the tab last saved -- it
 * holds the agent's write, which is the diff's `newContent`. That, not the
 * tab's `lastSavedContent`, is the honest conflict baseline for these writes;
 * #3684 armed the conflict check here on exactly that reasoning.
 *
 * The ordering is the whole point of this module. The accept-all path cleared
 * the model's diff state before writing, so by the time the baseline was read
 * the `newContent` term was already gone and it silently fell back to the
 * pre-AI content -- which never matches disk, so *every* accept-all was
 * refused as a conflict and the user got the "file changed on disk" banner on
 * a change they had just accepted (#1408). Reading the baseline and clearing
 * the diff state are two halves of one operation; keeping them in separate
 * call sites is what let them drift apart.
 */
export interface DiffResolutionSaveDeps {
  /**
   * The content the agent wrote, i.e. what disk holds while the diff is
   * pending. `undefined` when no diff state remains, in which case
   * `fallbackBaseline` is used.
   *
   * Called before `clearDiffState`, and only once -- do not pass a getter that
   * is only valid after some other step has run.
   */
  readDiffBaseline(): string | undefined;
  /** The tab's own baseline, used only when no diff state is available. */
  fallbackBaseline: string;
  /**
   * Clear the model's diff state and fan the resolution out to siblings.
   * Optional: call sites that clear diff state elsewhere in their own sequence
   * omit it. Always invoked after the baseline has been read.
   */
  clearDiffState?(): void;
  saveFile(content: string, lastKnownContent: string): Promise<SaveAttemptResult | null>;
}

export type DiffResolutionSaveOutcome =
  /** Bytes are on disk. `baseline` is what disk now holds. */
  | { kind: 'saved'; result: SaveAttemptResult; baseline: string }
  /**
   * Disk moved after the diff was computed -- a second agent write landing
   * mid-review. Refused rather than clobbered; the caller surfaces the
   * conflict banner and abandons the rest of its resolution sequence.
   */
  | { kind: 'conflict'; diskContent: string }
  /** The write was refused for a non-conflict reason. */
  | { kind: 'failed'; result: SaveAttemptResult | null };

/**
 * Write the outcome of a diff resolution to disk against the agent's content
 * as the conflict baseline.
 */
export async function resolveDiffResolutionSave(
  content: string,
  deps: DiffResolutionSaveDeps,
): Promise<DiffResolutionSaveOutcome> {
  const baseline = deps.readDiffBaseline() ?? deps.fallbackBaseline;

  deps.clearDiffState?.();

  const result = await deps.saveFile(content, baseline);

  if (result?.conflict) {
    return {
      kind: 'conflict',
      diskContent: typeof result.diskContent === 'string' ? result.diskContent : '',
    };
  }

  if (!result?.success) {
    return { kind: 'failed', result: result ?? null };
  }

  return { kind: 'saved', result, baseline: content };
}
