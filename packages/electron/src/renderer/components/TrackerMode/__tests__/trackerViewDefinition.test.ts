/**
 * Applying a saved view and rebuilding the current definition is a round trip.
 * If the two ends disagree -- one writing the per-type Display Settings slot,
 * the other reading the workspace-wide fallback -- every saved view reads as
 * dirty forever and the header's "Save changes" affordance never clears.
 */
import { describe, expect, it } from 'vitest';
import { createDefaultViewDefinition } from '../trackerSavedViews';
import {
  applySavedViewToLayout,
  buildCurrentViewDefinition,
  savedViewMatchesCurrent,
} from '../trackerViewDefinition';
import { resolveTrackerViewSettings, type TrackerModeLayout } from '../../../store/atoms/trackers';

const BASE_LAYOUT: TrackerModeLayout = {
  selectedType: 'all',
  activeFilters: [],
  viewMode: 'list',
  selectedItemId: null,
  sidebarWidth: 220,
  sidebarCollapsed: false,
  detailPanelWidth: 400,
  typeColumnConfigs: {},
  typeColumnFilters: {},
  typeViewSettings: {},
  groupBy: 'none',
  ordering: 'manual',
  sortBy: 'lastIndexed',
  sortDirection: 'desc',
  recentlyViewedDays: 30,
  statusScope: 'open',
  inboxScope: 'global',
  itemViews: {},
  documentListPaneVisible: true,
  documentListPaneWidth: 280,
  documentRightPanelVisible: true,
  documentRightPanelWidth: 380,
  documentRightPanelMode: 'chat',
  documentChatSessions: {},
  collapsedOwnershipSections: [],
  expandedNavFolders: [],
  viewModeMigrated: true,
};

/** Apply a view, then ask the header's own predicate whether it looks dirty. */
function isDirtyAfterApplying(
  layout: TrackerModeLayout,
  view: ReturnType<typeof bugBoardView>,
): boolean {
  const applied: TrackerModeLayout = { ...layout, ...applySavedViewToLayout(layout, view) };
  const current = buildCurrentViewDefinition(
    applied,
    resolveTrackerViewSettings(applied, applied.selectedType),
    view.tagFilter,
  );
  return !savedViewMatchesCurrent(view, current);
}

function bugBoardView() {
  return {
    ...createDefaultViewDefinition(),
    selectedType: 'bug',
    viewMode: 'kanban' as const,
    groupBy: 'status' as const,
    ordering: 'priority',
    sortBy: 'created',
    sortDirection: 'asc' as const,
  };
}

describe('saved view round trip', () => {
  it('is not dirty the instant it is applied', () => {
    expect(isDirtyAfterApplying(BASE_LAYOUT, bugBoardView())).toBe(false);
  });

  it('is not dirty even when another type has its own Display Settings', () => {
    const layout: TrackerModeLayout = {
      ...BASE_LAYOUT,
      typeViewSettings: { plan: { viewMode: 'timeline', groupBy: 'milestone' } },
    };

    expect(isDirtyAfterApplying(layout, bugBoardView())).toBe(false);
  });

  it('is dirty once the applied type is regrouped', () => {
    const view = bugBoardView();
    const applied: TrackerModeLayout = { ...BASE_LAYOUT, ...applySavedViewToLayout(BASE_LAYOUT, view) };
    const regrouped: TrackerModeLayout = {
      ...applied,
      typeViewSettings: {
        ...applied.typeViewSettings,
        bug: { ...applied.typeViewSettings.bug, groupBy: 'assignee' },
      },
    };
    const current = buildCurrentViewDefinition(
      regrouped,
      resolveTrackerViewSettings(regrouped, regrouped.selectedType),
      view.tagFilter,
    );

    expect(savedViewMatchesCurrent(view, current)).toBe(false);
  });

  it('leaves the other types and the workspace fallback untouched', () => {
    const layout: TrackerModeLayout = {
      ...BASE_LAYOUT,
      typeViewSettings: { plan: { viewMode: 'timeline' } },
    };
    const patch = applySavedViewToLayout(layout, bugBoardView());

    expect(patch.typeViewSettings?.plan).toEqual({ viewMode: 'timeline' });
    expect(patch).not.toHaveProperty('viewMode');
    expect(patch).not.toHaveProperty('groupBy');
  });
});
