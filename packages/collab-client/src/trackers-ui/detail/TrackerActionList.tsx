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
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';

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

const ROW =
  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-nim '
  + 'hover:bg-nim-tertiary disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent';

export function TrackerActionList({ actions, onBeforeSelect }: TrackerActionListProps) {
  return (
    <>
      {actions.map((action) => {
        const rule = action.separatorBefore
          ? <div key={`${action.id}-rule`} className="my-1 border-t border-nim" aria-hidden="true" />
          : null;

        if (action.caption) {
          return (
            <React.Fragment key={action.id}>
              {rule}
              <div className="px-3 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-nim-faint">
                {action.label}
              </div>
            </React.Fragment>
          );
        }

        return (
          <React.Fragment key={action.id}>
            {rule}
            <button
              type="button"
              role="menuitem"
              disabled={action.disabled}
              // `MaterialSymbol` renders its ligature as plain text with no
              // `aria-hidden`, so the icon name fuses into the computed
              // accessible name -- "tagCopy item key". Stated explicitly here
              // rather than fixed in the icon, which is a wider blast radius
              // than this change.
              aria-label={action.label}
              className={ROW}
              onClick={() => {
                onBeforeSelect?.();
                void action.onSelect?.();
              }}
            >
              {action.swatch ? (
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: action.swatch }}
                />
              ) : action.icon ? (
                <MaterialSymbol icon={action.icon} size={16} className="text-nim-muted" />
              ) : null}
              <span className="min-w-0 flex-1 truncate">{action.label}</span>
            </button>
          </React.Fragment>
        );
      })}
    </>
  );
}
