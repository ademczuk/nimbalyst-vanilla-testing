import React from 'react';
import type { TrackerRecord } from '../../../runtime/src/core/TrackerRecord';
export interface TagBoardProps {
    /** Items already composed through the active saved view. */
    items: TrackerRecord[];
    /** Callback when user clicks a card to open the detail panel. */
    onItemSelect?: (itemId: string) => void;
    /** Currently selected item ID for card highlighting. */
    selectedItemId?: string | null;
    /** Open a card's item as a document (double-click). */
    onOpenDocument?: (itemId: string) => void;
    /** Personal lane, desktop only. Omitted by a host with team auth only. */
    renderUnreadSlot?: (itemId: string) => React.ReactNode;
    /** Personal lane, desktop only. Omitted by a host with team auth only. */
    renderFavoriteSlot?: (itemId: string) => React.ReactNode;
}
/**
 * Tag board view. Columns are driven by the schema `tags` role —
 * one column per distinct tag plus a trailing "Untagged" bucket. An item with
 * multiple tags shows up in every matching column. Read + click-to-select; the
 * kanban board remains the place for drag-driven status changes.
 */
export declare const TagBoard: React.FC<TagBoardProps>;
