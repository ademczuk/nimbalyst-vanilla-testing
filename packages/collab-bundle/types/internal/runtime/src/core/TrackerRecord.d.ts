import type { TrackerItem } from "./DocumentService";
import { type TrackerRecord } from "@nimbalyst/tracker-core";
export { dbRowToRecord, fromDbBoolean, recordToDbParams, } from "@nimbalyst/tracker-core";
export type { LinkedCommit, LinkedIssue, LinkedPullRequest, TrackerDerivedSignal, TrackerRecord, TrackerRecordSystem, } from "@nimbalyst/tracker-core";
/** Runtime compatibility adapter for the legacy DocumentService item shape. */
export declare function trackerItemToRecord(item: TrackerItem): TrackerRecord;
/** Runtime compatibility adapter for callers that still consume TrackerItem. */
export declare function trackerRecordToItem(record: TrackerRecord): TrackerItem;
