/**
 * Autosave for an embedded editor -- inline in a document, or a card on a board.
 *
 * Lifted out of `EmbedFrame` when the Project Canvas grew a second copy of it,
 * and the second copy is why this module exists rather than a comment saying
 * "see EmbedFrame". The canvas version had a two-second timer and nothing else:
 * no in-flight guard, no bounded retry, and -- the part that actually lost data
 * -- no flush on the way out, so cooling a card inside the debounce window threw
 * the user's edit away. A third divergent copy would find its own subset of the
 * same three problems.
 *
 * The three entry points are deliberately distinct, because they want different
 * things from the backoff:
 *
 * - `tick()` is the debounce timer. It respects everything: dirty, in-flight,
 *   the retry backoff, and the blocked latch. A timer that ignored backoff would
 *   hammer a failing write every two seconds forever.
 * - `flush()` is an exit path -- the editor is going read-only, unmounting, or
 *   the board is closing. It clears the backoff first and tries now, because
 *   "wait 30 more seconds" and "this surface is about to stop existing" cannot
 *   both be honoured and only one of them can lose bytes.
 * - `retry()` is a person clicking the blocked strip. It clears the latch.
 *
 * `isFlushing()` exists for the read-only guard in `createEmbeddedFileHost`. A
 * warm card refuses writes so a misbehaving extension cannot clobber disk from
 * view mode, and that guard is correct -- but the hot-to-warm flush is not a new
 * write in view mode, it is the last write of the edit session that just ended,
 * and it has to be let through. The latch is what tells the two apart.
 *
 * No React, no atoms: callers own the timer and the dirty flag.
 */

/** Two retries, then stop and tell the user. Matches the shipped embed cadence. */
export const EMBED_AUTOSAVE_FAILURE_RETRY_DELAYS_MS = [5_000, 30_000] as const;

export const EMBED_AUTOSAVE_MAX_ATTEMPTS =
  EMBED_AUTOSAVE_FAILURE_RETRY_DELAYS_MS.length + 1;

export interface EmbeddedAutosaveOptions {
  /**
   * Ask every registered save listener to write now. Must reject when a write
   * failed -- a resolved promise is taken as "the bytes are on disk" and clears
   * the failure state.
   */
  save(): Promise<void>;
  /** Whether the editor currently holds unsaved content. */
  isDirty(): boolean;
  /**
   * Called with the `errorType` of the failure that exhausted the retries, and
   * with `null` whenever the state clears. Surfaces the strip that tells a user
   * their edits are only in memory.
   */
  onBlockedChange?(errorType: string | null): void;
  /** Prefix for this surface's console errors, e.g. `[EmbedFrame]`. */
  label: string;
  /** Injectable clock, for tests. */
  now?(): number;
  /** Injectable backoff, for tests. */
  retryDelaysMs?: readonly number[];
}

export interface EmbeddedAutosaveController {
  /** Debounce-timer tick: save if dirty and nothing is holding us back. */
  tick(): Promise<void>;
  /**
   * Save now because this surface is going away or going read-only. Clears the
   * backoff first. `reason` only reaches the log line.
   */
  flush(reason: string): Promise<void>;
  /** User-initiated retry from the blocked strip. */
  retry(): Promise<void>;
  /** True while a `flush()` is draining; the read-only guard must allow it. */
  isFlushing(): boolean;
  /** Forget the failure state (the content changed, or a save succeeded). */
  reset(): void;
}

interface RejectedSave {
  errorType?: string;
}

export function createEmbeddedAutosaveController(
  options: EmbeddedAutosaveOptions
): EmbeddedAutosaveController {
  const now = options.now ?? (() => Date.now());
  const retryDelays =
    options.retryDelaysMs ?? EMBED_AUTOSAVE_FAILURE_RETRY_DELAYS_MS;
  const maxAttempts = retryDelays.length + 1;

  let inFlight = false;
  let flushing = false;
  let failureCount = 0;
  let nextAttemptAt = 0;
  let blocked = false;

  function reset(): void {
    failureCount = 0;
    nextAttemptAt = 0;
    if (blocked) {
      blocked = false;
      options.onBlockedChange?.(null);
    }
  }

  async function attempt(isFlush: boolean): Promise<void> {
    if (inFlight) return;
    if (!options.isDirty()) return;
    if (!isFlush && (blocked || now() < nextAttemptAt)) return;

    inFlight = true;
    if (isFlush) flushing = true;
    try {
      await options.save();
      reset();
    } catch (error) {
      failureCount += 1;
      const retryDelay = retryDelays[failureCount - 1];
      if (retryDelay === undefined) {
        blocked = true;
        options.onBlockedChange?.(errorTypeOf(error));
        console.error(
          `${options.label} Autosave blocked after ${maxAttempts} failed attempts`,
          error
        );
      } else {
        nextAttemptAt = now() + retryDelay;
        console.error(
          `${options.label} Autosave failed; retrying in ${retryDelay}ms`,
          error
        );
      }
    } finally {
      inFlight = false;
      flushing = false;
    }
  }

  return {
    tick: () => attempt(false),
    flush: (reason: string) => {
      if (!options.isDirty() || inFlight) return Promise.resolve();
      // An exit path is the last chance these bytes get, so the backoff is
      // dropped rather than waited out.
      reset();
      console.warn(`${options.label} Flushing unsaved embed content (${reason})`);
      return attempt(true);
    },
    retry: () => {
      reset();
      return attempt(false);
    },
    isFlushing: () => flushing,
    reset,
  };
}

/**
 * The `errorType` a rejected save carried, or `'unknown'`.
 *
 * Deliberately structural rather than an `instanceof FileSaveRejectedError`
 * check: this module is the shared piece and must not depend on which of the two
 * hosts' save paths threw, only on the field the strip renders.
 */
function errorTypeOf(error: unknown): string {
  const errorType = (error as RejectedSave | null)?.errorType;
  return typeof errorType === 'string' && errorType !== '' ? errorType : 'unknown';
}
