import {
  compareTrackerNavigationEntries,
  type TrackerNavigationEntry,
  type TrackerNavigationFolder,
  type TrackerTypePlacement,
} from '@nimbalyst/runtime/sync/trackerNavigation';
import type { TrackerDataModel } from '@nimbalyst/runtime/plugins/TrackerPlugin/models';

export interface TrackerNavigationFolderNode {
  folder: TrackerNavigationFolder;
  trackerTypes: Array<{ tracker: TrackerDataModel; placement: TrackerTypePlacement }>;
}

export interface TrackerNavigationTree {
  folders: TrackerNavigationFolderNode[];
  rootTypes: Array<{ tracker: TrackerDataModel; placement: TrackerTypePlacement }>;
}

/** Whose a tracker is. A tracker owns its schema and its items together. */
export type TrackerOwnership = 'personal' | 'team';

export interface TrackerOwnershipSection {
  ownership: TrackerOwnership;
  tree: TrackerNavigationTree;
}

export function trackerOwnershipOf(tracker: TrackerDataModel): TrackerOwnership {
  return tracker.sharing === 'team' ? 'team' : 'personal';
}

/**
 * Split the navigation tree into "the team's" and "mine", in that display
 * order — the team's trackers are the shared source of truth and carry most of
 * the data, so they lead.
 *
 * Returns null when the workspace has no team: a solo user gets no sections and
 * no ownership language at all, just the flat tree they already had. The
 * grammar appears when they join a team.
 *
 * Folders stay the grouping, and a folder belongs to exactly one section — the
 * one matching its own ownership. An empty folder still renders: you have to be
 * able to see the folder you just made before you can drag anything into it.
 * A tracker sitting in a folder of the other ownership (someone just shared it)
 * falls to the root of its own section rather than conjuring a ghost folder.
 * Both sections remain visible even when empty because their headers own the
 * create-folder actions. Dropping an empty section would also drop the only way
 * to create its first folder.
 */
export function partitionTrackerNavigationByOwnership(
  tree: TrackerNavigationTree,
  options: { hasTeam: boolean },
): TrackerOwnershipSection[] | null {
  if (!options.hasTeam) return null;

  const sections: TrackerOwnershipSection[] = [];
  for (const ownership of ['team', 'personal'] as const) {
    const mine = (row: { tracker: TrackerDataModel }) => trackerOwnershipOf(row.tracker) === ownership;
    const folders: TrackerNavigationFolderNode[] = [];
    const displaced: TrackerNavigationFolderNode['trackerTypes'] = [];
    for (const node of tree.folders) {
      if (folderOwnershipOf(node.folder) === ownership) {
        folders.push({ folder: node.folder, trackerTypes: node.trackerTypes.filter(mine) });
      } else {
        displaced.push(...node.trackerTypes.filter(mine));
      }
    }
    const rootTypes = [...tree.rootTypes.filter(mine), ...displaced]
      .sort((a, b) => compareTrackerNavigationEntries(a.placement, b.placement));
    sections.push({ ownership, tree: { folders, rootTypes } });
  }
  return sections;
}

/** A folder written before ownership existed reads as personal until the store says otherwise. */
export function folderOwnershipOf(folder: TrackerNavigationFolder): TrackerOwnership {
  return folder.ownership === 'team' ? 'team' : 'personal';
}

export function buildTrackerNavigationTree(
  trackerTypes: TrackerDataModel[],
  entries: TrackerNavigationEntry[],
): TrackerNavigationTree {
  const folders = entries
    .filter((entry): entry is TrackerNavigationFolder => entry.kind === 'folder')
    .sort(compareTrackerNavigationEntries);
  const folderIds = new Set(folders.map((folder) => folder.folderId));
  const placementByType = new Map<string, TrackerTypePlacement>();
  for (const entry of entries) {
    if (entry.kind === 'type-placement' && !placementByType.has(entry.trackerType)) {
      placementByType.set(entry.trackerType, entry);
    }
  }

  const fallbackPlacement = (trackerType: string, index: number): TrackerTypePlacement => ({
    entryId: `type:${trackerType}`,
    kind: 'type-placement',
    trackerType,
    folderId: null,
    sortKey: `z${String(index).padStart(8, '0')}`,
  });

  const rows = trackerTypes.map((tracker, index) => {
    const placement = placementByType.get(tracker.type) ?? fallbackPlacement(tracker.type, index);
    return {
      tracker,
      placement: placement.folderId !== null && !folderIds.has(placement.folderId)
        ? { ...placement, folderId: null }
        : placement,
    };
  });

  const byFolder = new Map<string, typeof rows>();
  const rootTypes: typeof rows = [];
  for (const row of rows) {
    if (row.placement.folderId === null) rootTypes.push(row);
    else {
      const current = byFolder.get(row.placement.folderId) ?? [];
      current.push(row);
      byFolder.set(row.placement.folderId, current);
    }
  }
  const sortRows = (a: typeof rows[number], b: typeof rows[number]) =>
    compareTrackerNavigationEntries(a.placement, b.placement);
  rootTypes.sort(sortRows);
  return {
    folders: folders.map((folder) => ({
      folder,
      trackerTypes: (byFolder.get(folder.folderId) ?? []).sort(sortRows),
    })),
    rootTypes,
  };
}
