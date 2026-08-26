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

import React, { lazy, Suspense, useState } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import type { TrackerItemAction } from './TrackerActionList';

const loadTrackerItemActionsPopover = () =>
  import('./TrackerItemActionsPopover');
const TrackerItemActionsPopover = lazy(() =>
  loadTrackerItemActionsPopover().then((module) => ({
    default: module.TrackerItemActionsPopover,
  }))
);

export type { TrackerItemAction };

export interface TrackerItemActionsMenuProps {
  actions: readonly TrackerItemAction[];
  /** Names the menu for assistive tech; the trigger is icon-only. */
  label?: string;
  className?: string;
}

export function TrackerItemActionsMenu({
  actions,
  label = 'Item actions',
  className,
}: TrackerItemActionsMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [reference, setReference] = useState<HTMLButtonElement | null>(null);
  if (actions.length === 0) return null;

  return (
    <>
      <button
        type="button"
        ref={setReference}
        className={`tracker-item-actions-trigger flex size-6 items-center justify-center rounded text-nim-faint hover:bg-nim-hover hover:text-nim ${
          className ?? ''
        }`}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onPointerEnter={() => {
          void loadTrackerItemActionsPopover();
        }}
        onFocus={() => {
          void loadTrackerItemActionsPopover();
        }}
        onPointerDown={() => {
          void loadTrackerItemActionsPopover();
        }}
        onClick={() => setIsOpen((open) => !open)}
      >
        <MaterialSymbol icon="more_vert" size={16} />
      </button>
      {isOpen && reference ? (
        <Suspense fallback={null}>
          <TrackerItemActionsPopover
            actions={actions}
            reference={reference}
            onClose={() => setIsOpen(false)}
          />
        </Suspense>
      ) : null}
    </>
  );
}
