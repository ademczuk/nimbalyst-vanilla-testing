// @vitest-environment jsdom
/**
 * The tracker `viewMode` literal has been rewritten twice: `'table'` used to
 * mean the row list, and `'grid'` used to mean the RevoGrid table while it sat
 * beside a hand-rolled one. Workspace state outlives both renames, so these
 * cover what an old persisted value loads as today.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '@nimbalyst/runtime/store';
import {
  initTrackerPanelLayout,
  setTrackerModeLayoutAtom,
  setTrackerTypeViewSettingsAtom,
  toggleTrackerSidebarCollapsedAtom,
  trackerActiveViewSettingsAtom,
  trackerModeLayoutAtom,
  trackerSidebarCollapsedAtom,
  type TrackerModeLayout,
} from '../trackers';

const invoke = vi.fn();

beforeEach(() => {
  invoke.mockReset();
  (window as any).electronAPI = { invoke };
});

async function loadWith(trackerModeLayout: Record<string, unknown>): Promise<string> {
  invoke.mockImplementation(async (channel: string) => {
    if (channel === 'workspace:get-state') return { trackerModeLayout };
    return undefined;
  });
  await initTrackerPanelLayout('/ws/migration');
  return store.get(trackerModeLayoutAtom).viewMode;
}

async function loadLayoutWith(trackerModeLayout: Record<string, unknown>): Promise<TrackerModeLayout> {
  await loadWith(trackerModeLayout);
  return store.get(trackerModeLayoutAtom);
}

describe('tracker viewMode migration', () => {
  it("folds the retired 'grid' mode into the RevoGrid-backed 'table'", async () => {
    expect(await loadWith({ viewMode: 'grid', viewModeMigrated: true })).toBe('table');
  });

  it("folds 'grid' in even for workspaces that predate the first rename", async () => {
    expect(await loadWith({ viewMode: 'grid' })).toBe('table');
  });

  it("still rewrites a pre-rename 'table' to the row list exactly once", async () => {
    expect(await loadWith({ viewMode: 'table' })).toBe('list');
    expect(await loadWith({ viewMode: 'table', viewModeMigrated: true })).toBe('table');
  });

  it('passes the other modes through untouched', async () => {
    expect(await loadWith({ viewMode: 'kanban', viewModeMigrated: true })).toBe('kanban');
    expect(await loadWith({ viewMode: 'tag-board', viewModeMigrated: true })).toBe('tag-board');
    expect(await loadWith({ viewMode: 'inbox', viewModeMigrated: true })).toBe('inbox');
  });

  it('falls back to the default for an unknown literal', async () => {
    expect(await loadWith({ viewMode: 'spreadsheet', viewModeMigrated: true })).toBe('list');
  });
});

describe('tracker view state migration', () => {
  it('promotes legacy per-column grouping and fills new defaults while stripping the parallel field', async () => {
    const layout = await loadLayoutWith({
      selectedType: 'bug',
      typeColumnConfigs: {
        bug: {
          visibleColumns: ['type', 'title', 'status'],
          columnWidths: { title: 320 },
          groupBy: 'owner',
        },
      },
    });

    expect(layout.groupBy).toBe('assignee');
    expect(layout.ordering).toBe('manual');
    expect(layout.typeColumnConfigs.bug).toEqual({
      visibleColumns: ['type', 'title', 'status'],
      columnWidths: { title: 320 },
    });
  });

  it('prefers current saved-view-owned values over the legacy column field', async () => {
    const layout = await loadLayoutWith({
      selectedType: 'bug',
      groupBy: 'goal',
      ordering: 'priority',
      typeColumnConfigs: {
        bug: { visibleColumns: ['title'], columnWidths: {}, groupBy: 'status' },
      },
    });
    expect(layout).toMatchObject({ groupBy: 'goal', ordering: 'priority' });
  });
});

/**
 * Display Settings are remembered per tracker type (#1412). The root-level
 * fields survive as the fallback for a type that has never been configured,
 * which is what lets an upgrading workspace open on the view it was left in.
 */
describe('per-type Display Settings', () => {
  const ROOT_VIEW = {
    viewMode: 'kanban',
    viewModeMigrated: true,
    groupBy: 'milestone',
    ordering: 'priority',
    sortBy: 'created',
    sortDirection: 'asc',
  } as const;

  it('reads through to the workspace values for a type with no settings of its own', async () => {
    await loadLayoutWith({ ...ROOT_VIEW, selectedType: 'bug' });

    expect(store.get(trackerActiveViewSettingsAtom)).toEqual({
      viewMode: 'kanban',
      groupBy: 'milestone',
      ordering: 'priority',
      sortBy: 'created',
      sortDirection: 'asc',
    });
  });

  it('keeps one type\'s grouping out of every other type', async () => {
    await loadLayoutWith({ ...ROOT_VIEW, selectedType: 'bug' });

    store.set(setTrackerTypeViewSettingsAtom, { typeKey: 'bug', groupBy: 'status' });
    expect(store.get(trackerActiveViewSettingsAtom).groupBy).toBe('status');

    store.set(setTrackerModeLayoutAtom, { selectedType: 'plan' });
    expect(store.get(trackerActiveViewSettingsAtom).groupBy).toBe('milestone');

    // ...and the fallback itself is untouched, so a type configured later still
    // inherits the workspace value rather than the last type someone edited.
    expect(store.get(trackerModeLayoutAtom).groupBy).toBe('milestone');
  });

  it('restores each type to its own settings and leaves the others alone', async () => {
    await loadLayoutWith({
      ...ROOT_VIEW,
      selectedType: 'bug',
      typeViewSettings: {
        bug: { viewMode: 'table', groupBy: 'status', sortBy: 'updated', sortDirection: 'desc' },
        plan: { viewMode: 'timeline' },
      },
    });

    expect(store.get(trackerActiveViewSettingsAtom)).toEqual({
      viewMode: 'table',
      groupBy: 'status',
      // Never set for bugs, so it still reads the workspace fallback.
      ordering: 'priority',
      sortBy: 'updated',
      sortDirection: 'desc',
    });

    store.set(setTrackerModeLayoutAtom, { selectedType: 'plan' });
    expect(store.get(trackerActiveViewSettingsAtom)).toMatchObject({
      viewMode: 'timeline',
      groupBy: 'milestone',
    });
  });

  it('treats an unusable persisted field as absent rather than as a default', async () => {
    const layout = await loadLayoutWith({
      ...ROOT_VIEW,
      selectedType: 'bug',
      typeViewSettings: {
        bug: {
          viewMode: 'spreadsheet',
          groupBy: 'phase-of-moon',
          sortDirection: 'sideways',
          sortBy: 'updated',
        },
        // The retired 'grid' literal still means the RevoGrid table.
        task: { viewMode: 'grid', groupBy: 'owner' },
        idea: 'not-an-object',
      },
    });

    expect(layout.typeViewSettings).toEqual({
      bug: { sortBy: 'updated' },
      task: { viewMode: 'table', groupBy: 'assignee' },
    });
    // The garbage fields fall through to the workspace view, not to 'list'/'none'.
    expect(store.get(trackerActiveViewSettingsAtom)).toMatchObject({
      viewMode: 'kanban',
      groupBy: 'milestone',
      sortDirection: 'asc',
    });
  });

  it('keeps a stable identity while unrelated layout state churns', async () => {
    await loadLayoutWith({ ...ROOT_VIEW, selectedType: 'bug' });

    const before = store.get(trackerActiveViewSettingsAtom);
    store.set(setTrackerModeLayoutAtom, { selectedItemId: 'item-1' });

    // Selecting an item must not re-render every consumer of Display Settings.
    expect(store.get(trackerActiveViewSettingsAtom)).toBe(before);
  });
});

describe('tracker sidebar collapse', () => {
  it('opens the sidebar for layouts persisted before the key existed', async () => {
    await loadLayoutWith({ viewMode: 'list', viewModeMigrated: true });
    expect(store.get(trackerSidebarCollapsedAtom)).toBe(false);
  });

  it('restores a persisted collapse and toggles back open', async () => {
    await loadLayoutWith({ viewMode: 'list', viewModeMigrated: true, sidebarCollapsed: true });
    expect(store.get(trackerSidebarCollapsedAtom)).toBe(true);

    store.set(toggleTrackerSidebarCollapsedAtom);
    expect(store.get(trackerSidebarCollapsedAtom)).toBe(false);

    store.set(toggleTrackerSidebarCollapsedAtom);
    expect(store.get(trackerSidebarCollapsedAtom)).toBe(true);
  });
});
