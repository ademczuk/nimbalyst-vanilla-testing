/**
 * A tracker action menu anchored to a pointer position.
 *
 * The same rows `TrackerItemActionsMenu` draws, hung off a virtual reference at
 * the point the reader right-clicked rather than off a trigger element. The
 * anchoring is `@floating-ui/react`'s and not arithmetic: a context menu opens
 * at the edge of the viewport more often than anywhere else, which is exactly
 * where hand-computed `position: fixed` coordinates put half the menu
 * off-screen.
 *
 * Rendered through `FloatingPortal`, so it escapes the `overflow: hidden` on
 * every pane a tracker row can live in.
 */

import React, { lazy, Suspense } from 'react';
import type { TrackerItemAction } from './TrackerActionList';

export interface TrackerContextMenuPoint {
  x: number;
  y: number;
}

export interface TrackerContextMenuProps {
  /** Viewport coordinates of the gesture. Null closes the menu. */
  point: TrackerContextMenuPoint | null;
  actions: readonly TrackerItemAction[];
  onClose: () => void;
  /** Names the menu for assistive tech. */
  label?: string;
  className?: string;
}

const loadTrackerContextMenuPopover = () =>
  import('./TrackerContextMenuPopover');
const TrackerContextMenuPopover = lazy(() =>
  loadTrackerContextMenuPopover().then((module) => ({
    default: module.TrackerContextMenuPopover,
  }))
);

export function TrackerContextMenu({
  point,
  actions,
  onClose,
  label = 'Item actions',
  className,
}: TrackerContextMenuProps) {
  if (!point) return null;

  return (
    <Suspense fallback={null}>
      <TrackerContextMenuPopover
        point={point}
        actions={actions}
        onClose={onClose}
        label={label}
        className={className}
      />
    </Suspense>
  );
}
