/**
 * The rows inside a tracker action menu.
 *
 * Split out of `TrackerItemActionsMenu` when a second menu needed the same
 * body: the header's overflow menu hangs off a trigger button, a row's context
 * menu hangs off a pointer position, and only the anchoring differs. Keeping
 * the rows in one place is what stops "right-click a row" and "click the ⋯"
 * from drifting into two different-looking lists of the same actions.
 *
 * A `caption` entry is a non-interactive group heading, so a menu can offer a
 * short run of status values under a label without needing a submenu.
 */
import React from 'react';
export interface TrackerItemAction {
    id: string;
    label: string;
    /** Material Symbols ligature name; omit for a text-only row. */
    icon?: string;
    /** Present but unavailable, so the affordance is not silently missing. */
    disabled?: boolean;
    /** Draws a rule above this row, grouping what follows. */
    separatorBefore?: boolean;
    /** A heading rather than a command: rendered, never focusable, never invoked. */
    caption?: boolean;
    /** A swatch chip before the label, for a status or priority value. */
    swatch?: string;
    onSelect?: () => void | Promise<void>;
}
export interface TrackerActionListProps {
    actions: readonly TrackerItemAction[];
    /** Called before the action runs, so the owning menu can close itself. */
    onBeforeSelect?: () => void;
}
export declare function TrackerActionList({ actions, onBeforeSelect }: TrackerActionListProps): React.JSX.Element;
