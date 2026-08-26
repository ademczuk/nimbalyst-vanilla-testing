/**
 * Rows for a saved view, on a host that may not have a personal lane.
 *
 * One place decides what a view means so the list, the grid, and the board can
 * never disagree about it -- and one place decides what happens when part of the
 * view is unanswerable here. `filterTrackerItems` would happily evaluate a
 * `favorite` clause against an empty favorites set and return nothing; that is
 * the failure this hook exists to prevent (see `personalViewClauses`).
 */
import type { TrackerRecord } from '../../../runtime/src/core/TrackerRecord';
import type { Readiness } from '../../../runtime/src/plugins/TrackerPlugin/models/trackerReadiness';
import type { TrackerIdentity } from '../../../runtime/src/core/DocumentService';
import { type PersonalViewClause, type SavedViewDefinition } from '../trackers/index';
import { type TrackerUICapabilities } from './TrackersUIProvider';
export interface TrackerViewRowsOptions {
    identity: TrackerIdentity | null;
    /** Explicit host declaration for callers outside a TrackersUIProvider. */
    capabilities?: TrackerUICapabilities;
    /** Free-text search applied in the same row-selection pass as the saved view. */
    searchTerm?: string;
    /** Dependency readiness, derived once from the whole corpus by the host. */
    readinessByItemId?: ReadonlyMap<string, Readiness>;
    /** Personal favorites; only ever populated where a personal lane exists. */
    favoriteItemIds?: ReadonlySet<string>;
    viewedAtByItemId?: ReadonlyMap<string, number>;
    nowMs?: number;
}
export interface TrackerViewRows {
    rows: TrackerRecord[];
    /** Non-empty when the view asked something this host cannot answer. */
    personalClauses: PersonalViewClause[];
}
export declare function useTrackerViewRows(records: TrackerRecord[], definition: SavedViewDefinition, options: TrackerViewRowsOptions): TrackerViewRows;
