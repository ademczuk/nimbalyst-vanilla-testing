// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { TrackerDataModel } from '@nimbalyst/runtime/plugins/TrackerPlugin/models';
import {
  buildTrackerNavigationTree,
  partitionTrackerNavigationByOwnership,
} from '../trackerNavigationTree';
import {
  normalizeCollapsedOwnershipSections,
  normalizeExpandedNavFolders,
  toggleListEntry,
} from '../trackerSidebarCollapse';

const model = (type: string): TrackerDataModel => ({
  type,
  displayName: type,
  displayNamePlural: `${type}s`,
  icon: 'check',
  color: '#000',
  modes: { inline: true, fullDocument: false },
  idPrefix: type.toUpperCase(),
  idFormat: 'uuid',
  fields: [],
});

describe('buildTrackerNavigationTree', () => {
  it('files built-in and custom types, preserves manual order, and leaves each type exactly once', () => {
    const tree = buildTrackerNavigationTree([model('bug'), model('custom'), model('task')], [
      { entryId: 'folder:delivery', kind: 'folder', folderId: 'delivery', name: 'Delivery', sortKey: 'a0', ownership: 'personal' },
      { entryId: 'type:task', kind: 'type-placement', trackerType: 'task', folderId: 'delivery', sortKey: 'a1' },
      { entryId: 'type:custom', kind: 'type-placement', trackerType: 'custom', folderId: 'delivery', sortKey: 'a0' },
      { entryId: 'type:bug', kind: 'type-placement', trackerType: 'bug', folderId: null, sortKey: 'a0' },
    ]);
    expect(tree.folders[0].trackerTypes.map((row) => row.tracker.type)).toEqual(['custom', 'task']);
    expect(tree.rootTypes.map((row) => row.tracker.type)).toEqual(['bug']);
  });

  it('projects missing folder references and missing placements safely at root', () => {
    const tree = buildTrackerNavigationTree([model('bug'), model('task')], [
      { entryId: 'type:task', kind: 'type-placement', trackerType: 'task', folderId: 'gone', sortKey: 'a0' },
    ]);
    expect(tree.folders).toEqual([]);
    expect(new Set(tree.rootTypes.map((row) => row.tracker.type))).toEqual(new Set(['bug', 'task']));
  });
});

describe('partitionTrackerNavigationByOwnership', () => {
  const teamModel = (type: string): TrackerDataModel => ({ ...model(type), sharing: 'team' });

  const treeOf = (
    models: TrackerDataModel[],
    folder?: 'personal' | 'team',
  ) => buildTrackerNavigationTree(
    models,
    folder
      ? [
        { entryId: 'folder:d', kind: 'folder', folderId: 'd', name: 'Delivery', sortKey: 'a0', ownership: folder },
        ...models.map((m, i) => ({
          entryId: `type:${m.type}` as `type:${string}`,
          kind: 'type-placement' as const,
          trackerType: m.type,
          folderId: 'd',
          sortKey: `a${i}`,
        })),
      ]
      : [],
  );

  it('gives a solo user no sections at all', () => {
    expect(partitionTrackerNavigationByOwnership(
      treeOf([model('plan'), teamModel('bug')]),
      { hasTeam: false },
    )).toBeNull();
  });

  it('splits trackers by ownership, team first, treating an absent sharing bit as personal', () => {
    const sections = partitionTrackerNavigationByOwnership(
      treeOf([model('plan'), teamModel('bug'), model('reading')]),
      { hasTeam: true },
    );
    expect(sections?.map((s) => [s.ownership, s.tree.rootTypes.map((r) => r.tracker.type)])).toEqual([
      ['team', ['bug']],
      ['personal', ['plan', 'reading']],
    ]);
  });

  it('keeps a folder in its own section and drops a mismatched tracker to the other section\'s root', () => {
    const sections = partitionTrackerNavigationByOwnership(
      treeOf([model('plan'), teamModel('bug')], 'personal'),
      { hasTeam: true },
    );
    expect(sections?.map((s) => [
      s.ownership,
      s.tree.folders.map((f) => f.trackerTypes.map((r) => r.tracker.type)),
      s.tree.rootTypes.map((r) => r.tracker.type),
    ])).toEqual([
      ['team', [], ['bug']],
      ['personal', [['plan']], []],
    ]);
  });

  it('renders a folder you just created, before anything is in it', () => {
    const sections = partitionTrackerNavigationByOwnership(
      buildTrackerNavigationTree([teamModel('bug')], [
        { entryId: 'folder:empty', kind: 'folder', folderId: 'empty', name: 'Later', sortKey: 'a0', ownership: 'personal' },
        { entryId: 'type:bug', kind: 'type-placement', trackerType: 'bug', folderId: null, sortKey: 'a1' },
      ]),
      { hasTeam: true },
    );
    expect(sections?.map((s) => [s.ownership, s.tree.folders.map((f) => f.folder.name)])).toEqual([
      ['team', []],
      ['personal', ['Later']],
    ]);
  });

  it('keeps an empty ownership section so its first folder can be created there', () => {
    const sections = partitionTrackerNavigationByOwnership(
      treeOf([teamModel('bug'), teamModel('feature')], 'team'),
      { hasTeam: true },
    );
    expect(sections?.map((s) => s.ownership)).toEqual(['team', 'personal']);
    expect(sections?.[0].tree.folders).toHaveLength(1);
    expect(sections?.[1].tree).toEqual({ folders: [], rootTypes: [] });
  });
});

describe('tracker sidebar collapse persistence', () => {
  it('loads state written by builds without the keys (or with junk) as sane defaults', () => {
    expect(normalizeCollapsedOwnershipSections(undefined)).toEqual([]);
    expect(normalizeCollapsedOwnershipSections('team')).toEqual([]);
    expect(normalizeCollapsedOwnershipSections(['team', 'nonsense', 'team', 42])).toEqual(['team']);
    expect(normalizeExpandedNavFolders(undefined)).toEqual([]);
    expect(normalizeExpandedNavFolders({ a: true })).toEqual([]);
    expect(normalizeExpandedNavFolders(['f1', 7, 'f1', 'f2'])).toEqual(['f1', 'f2']);
  });

  it('toggleListEntry adds once and removes cleanly', () => {
    expect(toggleListEntry(['a'], 'b', true)).toEqual(['a', 'b']);
    expect(toggleListEntry(['a', 'b'], 'b', true)).toEqual(['a', 'b']);
    expect(toggleListEntry(['a', 'b'], 'a', false)).toEqual(['b']);
    expect(toggleListEntry([], 'a', false)).toEqual([]);
  });
});
