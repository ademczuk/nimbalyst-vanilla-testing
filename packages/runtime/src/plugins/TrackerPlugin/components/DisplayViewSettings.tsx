/**
 * The view-defining half of Display Settings: view mode, the grouping axis the
 * board draws its columns from, and the ordering inside a group.
 *
 * Grouping options come from TRACKER_GROUPING_OPTIONS and ordering options from
 * the type's own sortable columns, so neither list can drift from the axes the
 * board actually resolves.
 */

import React from 'react';
import { MaterialSymbol } from '../../../ui/icons/MaterialSymbol';
import {
  normalizeTrackerGroupBy,
  TRACKER_GROUPING_OPTIONS,
  type TrackerGroupBy,
} from '../models/trackerGrouping';
import {
  MANUAL_TRACKER_ORDERING,
  getSupportedTrackerOrderingColumns,
  normalizeTrackerOrdering,
  type TrackerOrdering,
} from '../models/trackerOrdering';
import { CustomSelect, type SelectOption } from './CustomSelect';
import type { TrackerColumnDef } from './trackerColumns';

/** One selectable view mode. The vocabulary is the caller's, not the panel's. */
export interface DisplayOptionsViewMode {
  value: string;
  label: string;
  icon: string;
}

interface DisplayViewSettingsProps {
  availableColumns: TrackerColumnDef[];
  viewModes?: readonly DisplayOptionsViewMode[];
  viewMode?: string;
  onViewModeChange?: (viewMode: string) => void;
  groupBy?: TrackerGroupBy;
  onGroupByChange?: (groupBy: TrackerGroupBy) => void;
  ordering?: TrackerOrdering;
  onOrderingChange?: (ordering: TrackerOrdering) => void;
}

const GROUP_BY_OPTIONS: SelectOption[] = [
  { value: 'none', label: 'No grouping' },
  ...TRACKER_GROUPING_OPTIONS.map(option => ({ value: option.value, label: option.label })),
];

const SETTING_ROW = 'display-options-setting flex items-center gap-2 px-3 py-1.5';
const SETTING_LABEL = 'w-16 shrink-0 text-[11px] text-[var(--nim-text-muted)]';

export const DisplayViewSettings: React.FC<DisplayViewSettingsProps> = ({
  availableColumns,
  viewModes,
  viewMode,
  onViewModeChange,
  groupBy,
  onGroupByChange,
  ordering,
  onOrderingChange,
}) => {
  // Ordering draws from the columns this type already declares sortable, so a
  // new schema field becomes orderable without a second list to keep in sync.
  const orderingOptions: SelectOption[] = [
    { value: MANUAL_TRACKER_ORDERING, label: 'Manual' },
    ...getSupportedTrackerOrderingColumns(availableColumns)
      .map(column => ({ value: column.id, label: column.label })),
  ];

  const showViewModes = Boolean(viewModes?.length) && Boolean(onViewModeChange);
  const showGroupBy = groupBy !== undefined && Boolean(onGroupByChange);
  const showOrdering = ordering !== undefined && Boolean(onOrderingChange);
  if (!showViewModes && !showGroupBy && !showOrdering) return null;

  return (
    <div
      className="display-view-settings border-b border-[var(--nim-border)] pb-1.5"
      data-testid="tracker-display-view-settings"
    >
      {showViewModes && (
        <div
          className="display-options-view-modes grid grid-cols-3 gap-1 px-3 py-2"
          role="group"
          aria-label="View mode"
        >
          {viewModes?.map(mode => (
            <button
              key={mode.value}
              type="button"
              aria-pressed={mode.value === viewMode}
              onClick={() => onViewModeChange?.(mode.value)}
              data-testid={`tracker-display-view-mode-${mode.value}`}
              className={mode.value === viewMode
                ? 'flex flex-col items-center gap-0.5 rounded border border-[var(--nim-primary)] bg-[var(--nim-bg-tertiary)] px-1 py-1.5 text-[10px] text-[var(--nim-text)]'
                : 'flex flex-col items-center gap-0.5 rounded border border-transparent px-1 py-1.5 text-[10px] text-[var(--nim-text-muted)] hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-text)]'}
            >
              <MaterialSymbol icon={mode.icon} size={16} />
              {mode.label}
            </button>
          ))}
        </div>
      )}

      {showGroupBy && (
        <div className={SETTING_ROW}>
          <span className={SETTING_LABEL}>Columns</span>
          <div className="min-w-0 flex-1" data-testid="tracker-display-group-by">
            <CustomSelect
              value={groupBy as string}
              options={GROUP_BY_OPTIONS}
              onChange={value => onGroupByChange?.(normalizeTrackerGroupBy(value))}
              required
            />
          </div>
        </div>
      )}

      {showOrdering && (
        <div className={SETTING_ROW}>
          <span className={SETTING_LABEL}>Ordering</span>
          <div className="min-w-0 flex-1" data-testid="tracker-display-ordering">
            <CustomSelect
              value={ordering as string}
              options={orderingOptions}
              onChange={value => onOrderingChange?.(normalizeTrackerOrdering(value))}
              required
            />
          </div>
        </div>
      )}
    </div>
  );
};
