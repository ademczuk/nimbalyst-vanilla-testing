/** Re-export shim; the navigation tree is shared with the browser console. */
export {
  buildTrackerNavigationTree,
  folderOwnershipOf,
  partitionTrackerNavigationByOwnership,
  trackerOwnershipOf,
} from '@nimbalyst/collab-client/trackers';
export type {
  TrackerNavigationFolderNode,
  TrackerNavigationTree,
  TrackerOwnership,
  TrackerOwnershipSection,
} from '@nimbalyst/collab-client/trackers';
