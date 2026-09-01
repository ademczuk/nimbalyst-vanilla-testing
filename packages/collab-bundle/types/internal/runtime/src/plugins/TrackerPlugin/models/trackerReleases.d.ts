import type { TrackerRecord } from "../../../core/TrackerRecord";
import { type ReleaseNoteLine } from "@nimbalyst/tracker-core";
export { RELEASE_TYPE, releaseFinalizeFields, renderReleaseNotes, } from "@nimbalyst/tracker-core";
export type { ReleaseFinalizeInput, ReleaseNoteLine, } from "@nimbalyst/tracker-core";
export declare function findPendingReleases(items: TrackerRecord[], getStatus: (record: TrackerRecord) => string): TrackerRecord[];
export declare function releaseNoteLines(release: TrackerRecord, itemsById: ReadonlyMap<string, TrackerRecord>, getTitle: (record: TrackerRecord) => string): ReleaseNoteLine[];
