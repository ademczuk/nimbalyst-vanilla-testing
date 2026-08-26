/**
 * Tracker navigation: saved views first, then the schema's tracker tree.
 *
 * This is not desktop's sidebar with sections deleted. `TrackerSidebar` is
 * already organized this way -- views on top, types under them -- because both
 * axes are server-owned lanes (`savedView` and `navigation` in
 * `TrackerSyncEngine`). Recents and favorites never structured that list; they
 * were filter chips inside a view.
 *
 * The tree renders **flat**: `partitionTrackerNavigationByOwnership` splits it
 * into "The team's" and "Mine", and in a browser tab the personal half is
 * structurally empty. A permanently empty "Mine" header does not read as "you
 * have no personal trackers here" -- it reads as a sync that failed. So this
 * takes the same flat path a solo user already gets, which is the path with no
 * ownership grammar in it at all.
 *
 * Personal tracker types are absent for the same reason, one level down: their
 * items live in the author's own workspace and no room carries them, so a host
 * with no personal lane would list a tracker that is permanently empty. An
 * empty tracker does not read as "this one was never the team's" -- it reads as
 * a sync that failed. `BrowserTrackerSchemaStore` already declines to project
 * them; the filter here is what makes that a property of the surface rather
 * than of whoever fed it.
 *
 * Reordering, folder creation, rename, and delete are deliberately absent.
 * Organizing the tree is a desktop action; this surface navigates it.
 */
import React from 'react';
import type { TrackerDataModel } from '../../../../runtime/src/plugins/TrackerPlugin/models/index';
import type { TrackerNavigationEntry } from '../../../../runtime/src/sync/trackerNavigation';
import { type SavedView } from '../../trackers/index';
export interface TrackerNavigationProps {
    trackerTypes: TrackerDataModel[];
    navigationEntries: TrackerNavigationEntry[];
    savedViews: SavedView[];
    activeSavedViewId: string | null;
    /** `'all'` or a tracker type. */
    selectedType: string;
    /** Item count per tracker type, for the trailing number. */
    countsByType?: ReadonlyMap<string, number>;
    expandedFolderIds: readonly string[];
    onToggleFolder: (folderId: string) => void;
    onSelectType: (type: string) => void;
    onApplyView: (view: SavedView) => void;
    /** Omit where a view cannot be deleted or reshared; the control is then absent. */
    onDeleteView?: (view: SavedView) => void;
    onToggleShareView?: (view: SavedView) => void;
}
export declare function TrackerNavigation({ trackerTypes, navigationEntries, savedViews, activeSavedViewId, selectedType, countsByType, expandedFolderIds, onToggleFolder, onSelectType, onApplyView, onDeleteView, onToggleShareView, }: TrackerNavigationProps): React.JSX.Element;
