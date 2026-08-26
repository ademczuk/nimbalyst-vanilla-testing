/**
 * Option lists for the tracker header's column filters.
 *
 * A filter dropdown offers the values actually present in the current rows, with
 * counts, rather than the schema's full vocabulary. Relationship and identity
 * values arrive as objects, so this owns the one place that decides which key
 * identifies such a value and which one labels it.
 */
import type { TrackerRecord } from '../../../runtime/src/core/TrackerRecord';
import type { TrackerFilterField } from './trackerFilterFields';
export declare function buildHeaderFilterFields(filterFields: TrackerFilterField[], items: TrackerRecord[], getViewFilterValue: (item: TrackerRecord, fieldId: string) => unknown): TrackerFilterField[];
