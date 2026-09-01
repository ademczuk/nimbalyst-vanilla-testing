/**
 * Pure dependency-graph analysis and readiness derivation for tracker items.
 *
 * The generic entry points keep storage-shape adaptation at the caller boundary:
 * renderer records, MCP items, and CLI rows can share one edge implementation.
 * The TrackerRecord wrappers mirror trackerCollections for runtime callers.
 *
 * Graph work is one Tarjan SCC pass plus a union-find track partition. Both walk
 * iteratively on purpose: chain length is decided by whoever can create tracker
 * items, so recursion depth would be untrusted input and a long chain would
 * overflow the call stack, taking down every surface that renders readiness.
 *
 * Cost is O(V log V + E log E), not O(V + E): ids, blocker lists, and component
 * members are sorted so the output is deterministic. Callers persist and diff
 * these results, so stable ordering is worth the log factor.
 */
import type { TrackerCoreContext } from './context.js';
import type { TrackerRecord } from './trackerRecord.js';
import { type IssueKeyStatus } from './localIssueKey.js';
import { type StatusCategory } from './trackerStatusCategory.js';
export declare const DEPENDENCY_BLOCKER_KEY = "depends-on";
export declare const DEPENDENCY_BLOCKS_KEY = "blocks";
/**
 * Owned by `localIssueKey`, where the rest of the issue-key vocabulary lives.
 * Re-exported so a caller reading `BlockerRef.refStatus` needs only this module.
 */
export type { IssueKeyStatus };
export type ReadinessState = 'ready' | 'blocked' | 'closed';
export interface BlockerRef {
    itemId: string;
    ref: string;
    refStatus: IssueKeyStatus;
    title?: string;
    type: string;
    status: string;
    statusCategory: StatusCategory;
}
export interface Readiness {
    state: ReadinessState;
    /** Open direct blockers, with enough detail to explain the verdict. */
    blockedBy: BlockerRef[];
    /** Blocker ids not present in the corpus -- reported, not counted. */
    unresolvedBlockerIds: string[];
    /**
     * How many open dependents become ready the moment this item closes -- the
     * dependents whose only remaining open blocker is this item.
     *
     * Deliberately not the count of all open dependents. One that is also blocked
     * by something else does not move when this item closes, so counting it would
     * overstate the leverage of anything ranking a queue by this number.
     */
    unblocks: number;
    /** Member of a dependency cycle: will never become ready on its own. */
    inCycle: boolean;
    /** Stable id of the weakly connected component in the open dependency graph. */
    trackId: string;
}
export interface ReadinessReference {
    ref: string;
    refStatus: IssueKeyStatus;
}
/** Storage-shape seam shared by runtime, MCP, and CLI callers. */
export interface ReadinessAccessors<T> {
    getId: (item: T) => string;
    getType: (item: T) => string;
    getStatus: (item: T) => string;
    getTitle: (item: T) => string | undefined;
    getFieldValue: (item: T, fieldName: string) => unknown;
    getReference: (item: T) => ReadinessReference;
}
/**
 * Compute readiness for any in-memory item shape.
 *
 * `allItems` must be the FULL unfiltered corpus: every type and status,
 * including terminal and archived items. Filtering first turns satisfied
 * blockers into dangling ids and falsely marks their dependents ready. Build
 * the id index once here; never fetch blockers per item.
 */
export declare function computeReadinessForItems<T>(ctx: TrackerCoreContext, allItems: readonly T[], accessors: ReadinessAccessors<T>): Map<string, Readiness>;
/** TrackerRecord adapter shared by runtime and renderer callers. */
export declare function trackerRecordReadinessAccessors(ctx: TrackerCoreContext, getStatus?: (record: TrackerRecord) => string): ReadinessAccessors<TrackerRecord>;
/**
 * One pass over the FULL unfiltered TrackerRecord corpus. Mirrors
 * computeCollectionRollups and performs no per-blocker fetches.
 */
export declare function computeReadiness(ctx: TrackerCoreContext, allItems: TrackerRecord[], getStatus?: (record: TrackerRecord) => string): Map<string, Readiness>;
