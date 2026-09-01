/**
 * Recovery for tracker rows the old collision branch stranded without a key.
 *
 * ## What went wrong
 *
 * When a remote item arrived carrying an issue key some local row already
 * held, the client used to drop the room's allocation and keep the local
 * guess. The incoming row landed with `issue_number = NULL, issue_key = NULL`
 * -- but still `sync_status = 'synced'` and still carrying its `sync_id`.
 *
 * That combination is what makes it permanent. `TrackerSyncEngine` bootstraps
 * items from `MAX(sync_id)`, so a row whose `sync_id` sits below the cursor is
 * never re-sent. It is the same trap the schema lane documents at
 * `TrackerSyncEngine`'s schema bootstrap:
 *
 * > one workspace-wide MAX means any type whose version sits BELOW the cursor
 * > is never re-sent, so a row that was clobbered or never applied stays stale
 * > forever with no way back (#1178)
 *
 * Items page from MAX for a good reason -- there can be tens of thousands of
 * them -- so the schema lane's answer (always bootstrap from zero) is not
 * available here.
 *
 * ## The recovery
 *
 * Ask for one extra `trackerSync` from just below the oldest stranded row.
 * The room re-sends those rows with their identity intact, and now that the
 * collision branch resolves the other way the redelivery sticks instead of
 * being nulled again.
 *
 * No new protocol message and no server change: `trackerSync` already takes an
 * arbitrary `sinceSyncId`, and the room is already the authority on identity.
 *
 * The decision is a pure function so it can be tested without a socket, a room
 * or a database, per the destructive-data-paths rule about branches that can
 * otherwise only run inside an environment nobody can reproduce.
 */
import type { SyncId } from './trackerProtocol';
/** What the local projection knows about its own stranded rows. */
export interface StrandedIdentityFacts {
    /** Rows that are `synced`, carry a `sync_id`, and have no `issue_key`. */
    strandedCount: number;
    /** Lowest `sync_id` among them. Meaningless when `strandedCount` is 0. */
    minStrandedSyncId: SyncId;
    /** The cursor the ordinary bootstrap would have used. */
    localMaxSyncId: SyncId;
    /**
     * Whether this workspace has already run the recovery. Persisted, because
     * the pass must not re-request thousands of rows on every launch.
     */
    alreadyAttempted: boolean;
}
export type TrackerIdentityRecoveryPlan = {
    action: 'none';
    reason: 'no-stranded-rows' | 'already-attempted' | 'cursor-not-ahead';
} | {
    action: 'resync';
    sinceSyncId: SyncId;
    strandedCount: number;
    rewindDistance: number;
};
/**
 * Decide whether to re-request a span of the changelog, and from where.
 *
 * Returns `none` unless there is something to fix that a rewind can actually
 * fix. In particular a stranded row at or above the local cursor needs no
 * rewind -- the ordinary bootstrap already covers it, and rewinding to it
 * would re-request the whole tail for nothing.
 */
export declare function planTrackerIdentityRecovery(facts: StrandedIdentityFacts): TrackerIdentityRecoveryPlan;
