/**
 * Presentation for the plan status-drift signal, for the board card's chip.
 *
 * The signal itself is derived in the runtime (`derivePlanStatusSignals`); this
 * module only decides how to say it. Two rules it exists to hold:
 *
 *  - **It never writes.** A plan that looks shipped earns a chip, nothing else.
 *    Deriving "shipped" from commits is a heuristic: the audit that motivated
 *    this feature claimed four plans had shipped and two of the four did not
 *    survive reading the commits.
 *  - **It shows the evidence, not a verdict.** The wording is a question, and the
 *    commit shas and session ids ride along so the reader can check rather than
 *    believe. A confident "shipped" badge would be wrong often enough to matter.
 *
 * Signals normally arrive already attached to the record; deriving them here when
 * they are absent keeps the chip correct for records built by a path that skipped
 * the attach step, without introducing a second definition of the signal.
 */
import type { TrackerRecord } from '../../../runtime/src/core/TrackerRecord';
export interface PlanStatusDriftPresentation {
    /** Short chip label; phrased as a question because the signal can be wrong. */
    chipLabel: string;
    /** One-line statement of what disagrees, for the popover heading. */
    headline: string;
    /** Full commit shas, in signal order. */
    commitShas: string[];
    /** Session ids that produced those commits. */
    committedSessionIds: string[];
}
/** The chip's content, or null when the item's status and its commits agree. */
export declare function resolvePlanStatusDriftPresentation(item: TrackerRecord): PlanStatusDriftPresentation | null;
/** Abbreviate a sha for display without pretending it is the whole thing. */
export declare function shortSha(sha: string): string;
