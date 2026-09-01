import type { TrackerRecord } from "../../../core/TrackerRecord";
import { type Readiness, type ReadinessAccessors } from "@nimbalyst/tracker-core";
export { DEPENDENCY_BLOCKER_KEY, DEPENDENCY_BLOCKS_KEY, } from "@nimbalyst/tracker-core";
export type { BlockerRef, IssueKeyStatus, Readiness, ReadinessAccessors, ReadinessReference, ReadinessState, } from "@nimbalyst/tracker-core";
export declare function computeReadinessForItems<T>(allItems: readonly T[], accessors: ReadinessAccessors<T>): Map<string, Readiness>;
export declare function trackerRecordReadinessAccessors(getStatus?: (record: TrackerRecord) => string): ReadinessAccessors<TrackerRecord>;
export declare function computeReadiness(allItems: TrackerRecord[], getStatus: (record: TrackerRecord) => string): Map<string, Readiness>;
