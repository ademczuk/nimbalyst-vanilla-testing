import type { TrackerRecord } from "../../../core/TrackerRecord";
import { getRecordStatus } from "../trackerRecordAccessors";
import {
  computeReadiness as coreComputeReadiness,
  computeReadinessForItems as coreComputeReadinessForItems,
  trackerRecordReadinessAccessors as coreTrackerRecordReadinessAccessors,
  type Readiness,
  type ReadinessAccessors,
} from "@nimbalyst/tracker-core";
import { runtimeTrackerContext } from "./trackerCoreContext";

export {
  DEPENDENCY_BLOCKER_KEY,
  DEPENDENCY_BLOCKS_KEY,
} from "@nimbalyst/tracker-core";

export type {
  BlockerRef,
  IssueKeyStatus,
  Readiness,
  ReadinessAccessors,
  ReadinessReference,
  ReadinessState,
} from "@nimbalyst/tracker-core";

export function computeReadinessForItems<T>(
  allItems: readonly T[],
  accessors: ReadinessAccessors<T>
): Map<string, Readiness> {
  return coreComputeReadinessForItems(
    runtimeTrackerContext,
    allItems,
    accessors
  );
}

export function trackerRecordReadinessAccessors(
  getStatus: (record: TrackerRecord) => string = getRecordStatus
): ReadinessAccessors<TrackerRecord> {
  return coreTrackerRecordReadinessAccessors(runtimeTrackerContext, getStatus);
}

export function computeReadiness(
  allItems: TrackerRecord[],
  getStatus: (record: TrackerRecord) => string
): Map<string, Readiness> {
  return coreComputeReadiness(runtimeTrackerContext, allItems, getStatus);
}
