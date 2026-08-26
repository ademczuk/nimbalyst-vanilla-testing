/**
 * The lifecycle transitions of a tracker and its items, as pure functions.
 *
 * Three transitions live here, and they are the invisible part of the sharing
 * model -- what a reader cannot see by looking at the screen:
 *
 *   - **Draft -> Published** (per item). A draft has NO issue key at all (D2);
 *     the room mints one at publication and it is never rewritten afterwards.
 *   - **Personal -> Team** (per tracker). One-way. Promotion publishes the
 *     existing items, which is when they receive their keys.
 *   - **Active -> Archived** (per tracker). Items are RETAINED and become
 *     read-only, so everything stays visible, searchable and keyed. Archiving
 *     is not deletion and is not a demotion back to personal.
 *
 * Pure and I/O-free on purpose: the Electron main process drives the writes,
 * the renderer draws the surfaces, and both agree on the rules stated here.
 */
import type { TrackerDataModel } from './TrackerDataModel';
/**
 * The settled wording for an item that has no key yet. An unkeyed draft is
 * normal and intentional, not a failure -- this sentence is what says so.
 *
 * This module is the single source for the sentences below. The agent
 * tools import them directly; the CLI cannot (it vendors rather than depending
 * on the runtime, see `packages/cli/src/vendor/trackerRecord.ts`) and carries a
 * marked copy. Two hand-copies previously drifted here: only this file grew
 * `TRACKER_LOCAL_ISSUE_KEY_MESSAGE`, so the tools and the CLI kept telling a
 * numbered personal item it had "no key until it is published" -- on trackers
 * where publishing is refused outright (#1346, #1243).
 */
export declare const TRACKER_UNASSIGNED_ISSUE_KEY_MESSAGE = "This item has no key until it is published.";
/**
 * The settled wording for a workspace that has no team to mint keys.
 *
 * "Publish it" is the advice the other messages imply, and it is a dead end
 * here: publication succeeds locally and then waits on a room that does not
 * exist. Saying so is the whole point -- #1346 sat for nine days because the
 * app reported a pending key instead of an absent room.
 */
export declare const TRACKER_NO_TEAM_ISSUE_KEY_MESSAGE = "This workspace has no team, so no shared issue key can be issued \u2014 publishing will not produce one.";
/**
 * The settled wording for this machine's private number. The point it has to
 * land is that the number is not shareable: the same value on a colleague's
 * machine is a different item, so pasting it into a commit or a message sends
 * them somewhere else or nowhere at all.
 */
export declare const TRACKER_LOCAL_ISSUE_KEY_MESSAGE: string;
/**
 * The same point in one line, for a diagnostic surface that lists several refs
 * at once and would be drowned by the full sentence. Lifted verbatim from the
 * wording `TrackerBlockedChip` states inline; that component should import this
 * rather than restate it, so the two never drift into different advice.
 */
export declare const TRACKER_LOCAL_ISSUE_KEY_BRIEF_MESSAGE = "Dotted refs are numbered on this machine only \u2014 they will not resolve for anyone else.";
/**
 * What a dependency cycle means and what to do about it. Two surfaces explain
 * this one deadlock -- `TrackerDependencyCycleBanner` and the hover card in
 * `TrackerBlockedChip` -- and hand-maintained copies of an explanation are how
 * two surfaces end up giving different advice about the same hazard.
 *
 * Verbatim from the chip, so adopting it there is a no-op: that component still
 * states the sentence inline and should import this instead. It reads correctly
 * in both placements -- the banner introduces the cycle in the sentence before,
 * and the chip's card has no antecedent, which is why the subject is named
 * rather than pronominal.
 */
export declare const TRACKER_DEPENDENCY_CYCLE_MESSAGE = "These items depend on each other, so none of them can become ready until one of the links is removed.";
/** Whether a tracker has been retired. Absent means active. */
export declare function isTrackerArchived(model: Pick<TrackerDataModel, 'archived'> | null | undefined): boolean;
export interface TrackerWriteAccess {
    canWrite: boolean;
    /** Why writes are refused, phrased for a person. Absent when writable. */
    readOnlyReason?: string;
}
/**
 * Whether items in this tracker can still be edited.
 *
 * Read-only is the ONLY consequence of archiving. Reading, searching, following
 * a link and resolving an issue key all keep working -- so callers must gate
 * edit affordances on this and never gate visibility on it.
 */
export declare function resolveTrackerWriteAccess(model: Pick<TrackerDataModel, 'archived' | 'displayNamePlural'> | null | undefined): TrackerWriteAccess;
export type TrackerPromotionBlockedReason = 'archived';
export type TrackerPromotionMode = 'promote' | 'resume';
export interface TrackerPromotionEligibility {
    canPromote: boolean;
    /** First ownership transition, or an idempotent replay that finishes its item sweep. */
    mode?: TrackerPromotionMode;
    blockedReason?: TrackerPromotionBlockedReason;
    /** Why promotion is unavailable, or why replay is safe, phrased for a person. */
    message?: string;
}
/**
 * Whether a personal tracker can be promoted to the team.
 *
 * There is deliberately no inverse. Once the schema belongs to the team, this
 * same forward action remains available as an idempotent replay of the item
 * publication sweep. That is the recovery path after a partial promotion: items
 * that already finished keep their ids and keys, while unfinished items retry.
 * A team tracker is never demoted back to personal because that would strand
 * every teammate's items; archiving is the answer to "we should stop using this
 * tracker".
 */
export declare function resolveTrackerPromotionEligibility(model: Pick<TrackerDataModel, 'sharing' | 'archived'> | null | undefined): TrackerPromotionEligibility;
export interface TrackerConfirmationCopy {
    title: string;
    /** What will happen, stated plainly, including whether it can be undone. */
    message: string;
    confirmLabel: string;
}
/**
 * What the promotion confirmation says. Promotion is not destructive, but it is
 * irreversible and it hands the items to other people, so the copy names both
 * consequences: numbers get issued now, and there is no way back.
 */
export declare function describeTrackerPromotion(model: Pick<TrackerDataModel, 'displayNamePlural' | 'sharing'>, itemCount: number): TrackerConfirmationCopy;
/**
 * What the archive confirmation says. The whole job of this copy is to keep
 * archiving from reading as deletion, so it leads with what is kept.
 */
export declare function describeTrackerArchive(model: Pick<TrackerDataModel, 'displayNamePlural'>, itemCount: number): TrackerConfirmationCopy;
export declare function describeTrackerUnarchive(model: Pick<TrackerDataModel, 'displayNamePlural'>): TrackerConfirmationCopy;
export declare class TrackerIssueKeyRewriteError extends Error {
    readonly itemId: string;
    readonly existingKey: string;
    readonly incomingKey: string;
    constructor(itemId: string, existingKey: string, incomingKey: string);
}
/**
 * The key an item holds after a publish attempt.
 *
 * This is the D2 invariant in one place: publishing a keyless item adopts the
 * key the room minted; publishing an item that already has one KEEPS it, so a
 * re-publish (or a promotion that sweeps an already-published item) can never
 * consume a second number or renumber a key people have already cited.
 *
 * A disagreement is a bug in the room or the caller, never something to paper
 * over by picking a winner -- so it throws.
 */
export declare function reconcileIssueKeyOnPublish(params: {
    itemId: string;
    /** The key the item carried before publishing, if any. */
    existingKey?: string | null;
    /** The key observed on the item after publishing, if the room minted one. */
    mintedKey?: string | null;
}): {
    issueKey?: string;
    minted: boolean;
};
