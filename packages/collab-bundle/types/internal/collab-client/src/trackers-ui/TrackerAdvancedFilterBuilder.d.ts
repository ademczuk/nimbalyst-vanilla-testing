/**
 * The multi-clause filter builder behind the header's "Advanced filter" entry.
 *
 * It edits a draft copy of the clause set and only publishes on Apply, so a
 * half-typed clause never reaches the view. The draft seeds from the active
 * filters at mount, which is why the caller renders it only while the advanced
 * mode is open -- reopening restarts from what is actually applied.
 */
import type { JSX } from 'react';
import { type TrackerFieldFilter, type TrackerFilterSet } from '../../../runtime/src/plugins/TrackerPlugin/models/index';
import type { TrackerFilterField } from './trackerFilterFields';
export interface TrackerAdvancedFilterBuilderProps {
    filterFields: TrackerFilterField[];
    filters: TrackerFilterSet | null;
    onFiltersChange: (filters: TrackerFilterSet) => void;
    /** Back to the field command menu. */
    onBack: () => void;
    /** Close the whole filter menu (after applying or clearing). */
    onClose: () => void;
}
export declare function firstClause(fields: TrackerFilterField[]): TrackerFieldFilter;
export declare function TrackerAdvancedFilterBuilder({ filterFields, filters, onFiltersChange, onBack, onClose, }: TrackerAdvancedFilterBuilderProps): JSX.Element;
