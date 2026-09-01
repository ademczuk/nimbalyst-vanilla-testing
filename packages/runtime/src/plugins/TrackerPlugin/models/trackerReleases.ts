import type { TrackerRecord } from "../../../core/TrackerRecord";
import {
  findPendingReleases as coreFindPendingReleases,
  releaseNoteLines as coreReleaseNoteLines,
  type ReleaseNoteLine,
} from "@nimbalyst/tracker-core";
import { runtimeTrackerContext } from "./trackerCoreContext";

export {
  RELEASE_TYPE,
  releaseFinalizeFields,
  renderReleaseNotes,
} from "@nimbalyst/tracker-core";

export type {
  ReleaseFinalizeInput,
  ReleaseNoteLine,
} from "@nimbalyst/tracker-core";

export function findPendingReleases(
  items: TrackerRecord[],
  getStatus: (record: TrackerRecord) => string
): TrackerRecord[] {
  return coreFindPendingReleases(runtimeTrackerContext, items, getStatus);
}

export function releaseNoteLines(
  release: TrackerRecord,
  itemsById: ReadonlyMap<string, TrackerRecord>,
  getTitle: (record: TrackerRecord) => string
): ReleaseNoteLine[] {
  return coreReleaseNoteLines(
    runtimeTrackerContext,
    release,
    itemsById,
    getTitle
  );
}
