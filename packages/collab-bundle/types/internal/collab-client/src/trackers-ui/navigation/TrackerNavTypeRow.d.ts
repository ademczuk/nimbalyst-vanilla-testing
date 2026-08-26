/**
 * One row of the tracker navigation tree: type icon, name, trailing count.
 *
 * Desktop's `TrackerSidebar` and the browser console's pane are two hosts over
 * the same server-owned tree, and each had grown its own copy of this row. They
 * had already drifted: the console's copy lost the per-type icon color, which
 * is the one thing that lets a reader find a tracker in a ~25-row list without
 * reading every label, and the two disagreed on horizontal padding so a nested
 * row sat at a different indent in each.
 *
 * What actually differs between the hosts is behaviour, not appearance --
 * desktop drags rows to reorder the tree, the console only navigates it -- so
 * the difference arrives as DOM props on the button rather than as a second
 * component. Nothing here decides what a row does; `onClick`, `draggable`,
 * `data-testid` and the drag handlers all come from the host.
 *
 * The "All" row goes through here too, with a synthetic model. It is the same
 * row shape and it used to be a third hand-written copy in each host.
 */
import React from 'react';
import type { TrackerDataModel } from '../../../../runtime/src/plugins/TrackerPlugin/models/index';
/** Only the presentation fields, so a host can pass a synthetic row like "All". */
export type TrackerNavTypeModel = Pick<TrackerDataModel, 'type'> & Partial<Pick<TrackerDataModel, 'icon' | 'color' | 'displayName' | 'displayNamePlural'>>;
export interface TrackerNavTypeRowProps extends Omit<React.ComponentPropsWithoutRef<'button'>, 'color' | 'type'> {
    tracker: TrackerNavTypeModel;
    selected: boolean;
    /** Inside a folder: indented to clear the folder's disclosure arrow. */
    nested?: boolean;
    /**
     * A node rather than a number: desktop's count subscribes to the item store
     * itself so the sidebar does not re-render on every tracker write, and it
     * renders nothing at all while the atoms hydrate. The slot is always present
     * either way, so the labels beside it stay on one column.
     */
    count?: React.ReactNode;
}
export declare function TrackerNavTypeRow({ tracker, selected, nested, count, className, ...buttonProps }: TrackerNavTypeRowProps): React.JSX.Element;
/** The leading row. Not a tracker, but the same row, so it cannot drift from one. */
export declare const ALL_TRACKERS_NAV_MODEL: TrackerNavTypeModel;
