/** Portable tracker schema, grouping, ordering, and column model. */

export type { TrackerIdentity } from '@nimbalyst/runtime/core/DocumentService';
export type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
export * from '@nimbalyst/runtime/plugins/TrackerPlugin/models/TrackerDataModel';
export * from '@nimbalyst/runtime/plugins/TrackerPlugin/models/trackerGrouping';
export * from '@nimbalyst/runtime/plugins/TrackerPlugin/models/trackerOrdering';
export * from '@nimbalyst/runtime/plugins/TrackerPlugin/models/trackerRelationships';
export {
  getCellValue,
  getDefaultColumnConfig,
  getFieldForColumn,
  resolveColumnFieldName,
  resolveColumnsForType,
  type ColumnRenderType,
  type TrackerColumnDef,
  type TypeColumnConfig,
} from '@nimbalyst/runtime/plugins/TrackerPlugin/components/trackerColumns';

export type TrackerFilterChip = 'mine' | 'unassigned' | 'high-priority' | 'recently-updated'
  | 'favorites' | 'recently-viewed' | 'recently-edited-by-others' | 'archived';

export type TrackerStatusScope = 'open' | 'all' | 'closed';

export function normalizeTrackerStatusScope(raw: unknown): TrackerStatusScope {
  return raw === 'all' || raw === 'closed' ? raw : 'open';
}

export type SortColumn = 'title' | 'type' | 'status' | 'priority' | 'progress' | 'module'
  | 'lastIndexed' | (string & {});
export type SortDirection = 'asc' | 'desc';
