/**
 * Translation between the tracker mode layout and a `SavedViewDefinition`.
 *
 * These two are a round trip and have to stay each other's inverse: applying a
 * saved view and then rebuilding the current definition must reproduce the view,
 * or the header's "Save changes" affordance latches on and never clears.
 *
 * Display Settings live per tracker type (#1412), so both directions go through
 * the per-type slot rather than the workspace-wide fallback fields. Reading the
 * fallback on one side and writing the type slot on the other is exactly the
 * mismatch that pins a view dirty.
 */
import type { SavedViewDefinition } from './trackerSavedViews';
import type { TrackerModeLayout, TrackerTypeViewSettings } from '../../store/atoms/trackers';

/**
 * The definition describing what the tracker is showing right now, for
 * comparison against a saved view and as the payload when saving a new one.
 */
export function buildCurrentViewDefinition(
  layout: TrackerModeLayout,
  viewSettings: TrackerTypeViewSettings,
  tagFilter: string[],
): SavedViewDefinition {
  return {
    selectedType: layout.selectedType,
    activeFilters: layout.activeFilters,
    viewMode: viewSettings.viewMode,
    tagFilter,
    groupBy: viewSettings.groupBy,
    ordering: viewSettings.ordering,
    sortBy: viewSettings.sortBy,
    sortDirection: viewSettings.sortDirection,
    recentlyViewedDays: layout.recentlyViewedDays,
    columnConfig: layout.typeColumnConfigs[layout.selectedType] ?? null,
    columnFilters: layout.typeColumnFilters[layout.selectedType]
      ?? { combinator: 'and', clauses: [] },
    inboxScope: layout.inboxScope,
    statusScope: layout.statusScope,
  };
}

/**
 * Whether the tracker is still showing exactly what a saved view describes.
 * A `false` here is what lights up "Save changes" in the header.
 */
export function savedViewMatchesCurrent(
  saved: SavedViewDefinition,
  current: SavedViewDefinition,
): boolean {
  const scalarKeys = [
    'selectedType',
    'viewMode',
    'groupBy',
    'ordering',
    'sortBy',
    'sortDirection',
    'recentlyViewedDays',
  ] as const;
  if (scalarKeys.some(key => saved[key] !== current[key])) return false;
  if (JSON.stringify(saved.activeFilters) !== JSON.stringify(current.activeFilters)) return false;
  if (JSON.stringify(saved.tagFilter) !== JSON.stringify(current.tagFilter)) return false;
  // Null marks a legacy view that did not capture the field, so applying it
  // intentionally leaves the current value alone and must not look dirty.
  if (saved.columnConfig !== null
    && JSON.stringify(saved.columnConfig) !== JSON.stringify(current.columnConfig)) return false;
  if (saved.columnFilters !== null
    && JSON.stringify(saved.columnFilters) !== JSON.stringify(current.columnFilters)) return false;
  if (saved.inboxScope !== null && saved.inboxScope !== current.inboxScope) return false;
  return true;
}

/**
 * The layout patch that puts a saved view on screen.
 *
 * Display Settings land on the type the view names, so applying a bug view
 * cannot restyle the plan list. A view always captures all five, so the type's
 * slot is replaced rather than merged.
 */
export function applySavedViewToLayout(
  layout: TrackerModeLayout,
  definition: SavedViewDefinition,
): Partial<TrackerModeLayout> {
  return {
    selectedType: definition.selectedType,
    activeFilters: definition.activeFilters,
    recentlyViewedDays: definition.recentlyViewedDays,
    statusScope: definition.statusScope,
    ...(definition.inboxScope ? { inboxScope: definition.inboxScope } : {}),
    selectedItemId: null,
    typeViewSettings: {
      ...layout.typeViewSettings,
      [definition.selectedType]: {
        viewMode: definition.viewMode,
        groupBy: definition.groupBy,
        ordering: definition.ordering,
        sortBy: definition.sortBy,
        sortDirection: definition.sortDirection,
      },
    },
    // Only overwrite the column layout/filters when the view actually captured
    // them; older views leave the current table state alone.
    ...(definition.columnConfig
      ? {
        typeColumnConfigs: {
          ...layout.typeColumnConfigs,
          [definition.selectedType]: definition.columnConfig,
        },
      }
      : {}),
    ...(definition.columnFilters
      ? {
        typeColumnFilters: {
          ...layout.typeColumnFilters,
          [definition.selectedType]: definition.columnFilters,
        },
      }
      : {}),
  };
}
