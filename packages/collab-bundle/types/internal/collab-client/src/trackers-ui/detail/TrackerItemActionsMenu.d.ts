/**
 * The overflow menu on a tracker item's header.
 *
 * Deliberately an action *list*, not a menu that knows about tracker items. The
 * two hosts can honestly offer different things -- the desktop can open a
 * worktree and launch a session, a browser tab cannot -- and a component that
 * branched on which host it was in would be the same fork this directory
 * exists to remove. Each host declares what it can do; the menu draws it.
 *
 * Positioned through `useTrackerFloatingMenu` and rendered through
 * `FloatingPortal`, so it escapes the detail pane's `overflow` the same way
 * every other tracker menu does.
 */
import React from 'react';
import type { TrackerItemAction } from './TrackerActionList';
export type { TrackerItemAction };
export interface TrackerItemActionsMenuProps {
    actions: readonly TrackerItemAction[];
    /** Names the menu for assistive tech; the trigger is icon-only. */
    label?: string;
    className?: string;
}
export declare function TrackerItemActionsMenu({ actions, label, className, }: TrackerItemActionsMenuProps): React.JSX.Element | null;
