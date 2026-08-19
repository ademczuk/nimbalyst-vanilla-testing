/**
 * The view modes Display Settings offers, in the order the panel shows them.
 *
 * Every mode here is one TrackerMainView renders. A mode that is selectable but
 * silently draws a different view is worse than no control at all, so this file
 * deliberately has no mapping step.
 */

import type { ViewMode } from './TrackerMainView';

/** Every mode a saved view (or the persisted layout) may carry. */
export type TrackerViewMode = ViewMode;

export interface TrackerViewModeOption {
  value: TrackerViewMode;
  label: string;
  icon: string;
}

// A Record, so adding a mode to the union is a compile error until it has a
// label and an icon here.
const VIEW_MODE_PRESENTATION: Record<TrackerViewMode, Omit<TrackerViewModeOption, 'value'>> = {
  list: { label: 'List', icon: 'view_list' },
  table: { label: 'Table', icon: 'table_chart' },
  kanban: { label: 'Board', icon: 'view_kanban' },
  timeline: { label: 'Timeline', icon: 'align_horizontal_left' },
  'tag-board': { label: 'Tags', icon: 'sell' },
  inbox: { label: 'Inbox', icon: 'inbox' },
};

export const TRACKER_VIEW_MODE_OPTIONS: readonly TrackerViewModeOption[] =
  (Object.keys(VIEW_MODE_PRESENTATION) as TrackerViewMode[]).map(value => ({
    value,
    ...VIEW_MODE_PRESENTATION[value],
  }));

/** Narrow an arbitrary string (a panel choice, persisted state) to a mode. */
export function normalizeTrackerViewMode(
  value: string,
  fallback: TrackerViewMode = 'list',
): TrackerViewMode {
  return value in VIEW_MODE_PRESENTATION ? value as TrackerViewMode : fallback;
}
