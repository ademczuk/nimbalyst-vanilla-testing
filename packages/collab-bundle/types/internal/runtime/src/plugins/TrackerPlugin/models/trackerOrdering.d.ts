import type { TrackerRecord } from '../../../core/TrackerRecord';
export declare const MANUAL_TRACKER_ORDERING = "manual";
export declare const MANUAL_TRACKER_ORDER_FIELD = "kanbanSortOrder";
/** `manual` uses the existing kanban sort key; every other value is a schema field id. */
export type TrackerOrdering = typeof MANUAL_TRACKER_ORDERING | (string & {});
export declare function normalizeTrackerOrdering(value: unknown): TrackerOrdering;
export declare function resolveTrackerOrderingField(ordering: TrackerOrdering): string;
export declare function getSupportedTrackerOrderingColumns<T extends {
    id: string;
    sortable: boolean;
}>(columns: readonly T[]): T[];
export declare function resolveTrackerOrderingValue(item: TrackerRecord, ordering: TrackerOrdering): unknown;
