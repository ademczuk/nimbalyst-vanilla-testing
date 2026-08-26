import React from 'react';
import type { SavedView } from '../trackers/index';
/** The sidebar's Saved Views list (NIM-788), extracted verbatim from TrackerSidebar. */
export declare const TrackerSavedViewsSection: React.FC<{
    savedViews: SavedView[];
    activeSavedViewId: string | null;
    /** Sharing controls only make sense when the layout syncs to a team. */
    isSharedLayout: boolean;
    onApplyView: (view: SavedView) => void;
    /**
     * Omit on a host that cannot delete or reshare a view. The control is then not
     * rendered at all, rather than rendered against a handler that does nothing --
     * a button that silently declines is worse than an absent one.
     */
    onDeleteView?: (view: SavedView) => void;
    onToggleShareView?: (view: SavedView) => void;
}>;
