import type { TrackerItem } from "./DocumentService";
import {
  trackerItemToRecord as trackerItemToCoreRecord,
  trackerRecordToItem as trackerCoreRecordToItem,
  type TrackerRecord,
} from "@nimbalyst/tracker-core";

export {
  dbRowToRecord,
  fromDbBoolean,
  recordToDbParams,
} from "@nimbalyst/tracker-core";

export type {
  LinkedCommit,
  LinkedIssue,
  LinkedPullRequest,
  TrackerDerivedSignal,
  TrackerRecord,
  TrackerRecordSystem,
} from "@nimbalyst/tracker-core";

/** Runtime compatibility adapter for the legacy DocumentService item shape. */
export function trackerItemToRecord(item: TrackerItem): TrackerRecord {
  return trackerItemToCoreRecord(item);
}

/** Runtime compatibility adapter for callers that still consume TrackerItem. */
export function trackerRecordToItem(record: TrackerRecord): TrackerItem {
  return trackerCoreRecordToItem(record) as TrackerItem;
}
