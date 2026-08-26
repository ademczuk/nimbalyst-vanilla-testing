import type { TrackerRecord } from '../../../runtime/src/core/TrackerRecord';
import { type TrackerColumnDef } from '../../../runtime/src/plugins/TrackerPlugin/components/trackerColumns';
import type { TrackerDataModel } from '../../../runtime/src/plugins/TrackerPlugin/models/index';
import { type FilterContext } from '../trackers';
import type { TrackerFilterField } from './trackerFilterFields';
/** Build the filter menu's field catalog from the same columns every host renders. */
export declare function createTrackerFilterFields(availableColumns: TrackerColumnDef[], schemaType: string, trackerTypes: TrackerDataModel[]): TrackerFilterField[];
export declare function getTrackerHeaderFilterValue(item: TrackerRecord, field: string, availableColumns: TrackerColumnDef[], filterContext: FilterContext): unknown;
