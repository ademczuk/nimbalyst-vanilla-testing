import { type TrackerNavigationEntry, type TrackerNavigationFolder, type TrackerTypePlacement } from '../../../runtime/src/sync/trackerNavigation';
import type { TrackerDataModel } from '../../../runtime/src/plugins/TrackerPlugin/models/index';
export interface TrackerNavigationFolderNode {
    folder: TrackerNavigationFolder;
    trackerTypes: Array<{
        tracker: TrackerDataModel;
        placement: TrackerTypePlacement;
    }>;
}
export interface TrackerNavigationTree {
    folders: TrackerNavigationFolderNode[];
    rootTypes: Array<{
        tracker: TrackerDataModel;
        placement: TrackerTypePlacement;
    }>;
}
/** Whose a tracker is. A tracker owns its schema and its items together. */
export type TrackerOwnership = 'personal' | 'team';
export interface TrackerOwnershipSection {
    ownership: TrackerOwnership;
    tree: TrackerNavigationTree;
}
export declare function trackerOwnershipOf(tracker: TrackerDataModel): TrackerOwnership;
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
export declare function partitionTrackerNavigationByOwnership(tree: TrackerNavigationTree, options: {
    hasTeam: boolean;
}): TrackerOwnershipSection[] | null;
/** A folder written before ownership existed reads as personal until the store says otherwise. */
export declare function folderOwnershipOf(folder: TrackerNavigationFolder): TrackerOwnership;
export declare function buildTrackerNavigationTree(trackerTypes: TrackerDataModel[], entries: TrackerNavigationEntry[]): TrackerNavigationTree;
