import type { TrackerRecord } from '../../../runtime/src/core/TrackerRecord';
import type { TrackerColumnDef } from '../../../runtime/src/plugins/TrackerPlugin/components/trackerColumns';
/** Row key holding the tracker item id; prefixed so it cannot collide with a field name. */
export declare const ROW_ITEM_ID = "__trackerItemId";
/** Row key holding the primary tracker type for mixed-schema resolution. */
export declare const ROW_ITEM_TYPE = "__trackerItemType";
/** Structural pinned column owned by the host grid adapter. */
export declare const ROW_ACTIONS = "__trackerActions";
export type TrackerGridRow = Record<string, unknown>;
/** Build one portable grid source row per record, keyed by column id. */
export declare function buildGridSource(items: TrackerRecord[], columns: TrackerColumnDef[]): TrackerGridRow[];
