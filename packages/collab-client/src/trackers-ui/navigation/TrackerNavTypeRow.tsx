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
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import type { TrackerDataModel } from '@nimbalyst/runtime/plugins/TrackerPlugin/models';

/** Only the presentation fields, so a host can pass a synthetic row like "All". */
export type TrackerNavTypeModel = Pick<TrackerDataModel, 'type'>
  & Partial<Pick<TrackerDataModel, 'icon' | 'color' | 'displayName' | 'displayNamePlural'>>;

export interface TrackerNavTypeRowProps
  extends Omit<React.ComponentPropsWithoutRef<'button'>, 'color' | 'type'> {
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

export function TrackerNavTypeRow({
  tracker,
  selected,
  nested = false,
  count,
  className = '',
  ...buttonProps
}: TrackerNavTypeRowProps) {
  return (
    <button
      type="button"
      data-tracker-type={tracker.type}
      className={`tracker-nav-type-row w-full flex items-center gap-2 pr-2 py-1.5 rounded-md text-sm transition-colors ${
        nested ? 'pl-7' : 'pl-2'
      } ${
        selected ? 'bg-nim-active text-nim' : 'text-nim-muted hover:bg-nim-tertiary hover:text-nim'
      } ${className}`}
      {...buttonProps}
    >
      {/* The hue is schema data, not theme, so it is set inline from the model
          the same way the swatch pills take theirs. It stays on the icon when
          the row is selected: the color identifies the tracker, and a row that
          changed hue on selection would read as a different tracker. */}
      <span className="shrink-0" style={{ color: tracker.color }}>
        <MaterialSymbol icon={tracker.icon || 'checklist'} size={16} />
      </span>
      <span className="min-w-0 flex-1 text-left truncate">
        {tracker.displayNamePlural || tracker.displayName || tracker.type}
      </span>
      <span className="shrink-0 min-w-[20px] text-right text-[10px] font-semibold tabular-nums text-nim-muted">
        {count}
      </span>
    </button>
  );
}

/** The leading row. Not a tracker, but the same row, so it cannot drift from one. */
export const ALL_TRACKERS_NAV_MODEL: TrackerNavTypeModel = {
  type: 'all',
  icon: 'checklist',
  displayName: 'All',
};
