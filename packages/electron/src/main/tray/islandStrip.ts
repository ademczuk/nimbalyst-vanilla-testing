/**
 * Projection of `StripView` onto the island's wire shape.
 *
 * The island is a separate renderer, so it cannot import `StripView` from the
 * main-process tray module. This is the one place that maps between them --
 * pure, so the mapping is testable without a window.
 *
 * `workspacePath` is deliberately dropped: the island's rows carry their own
 * workspace from `TrayPanelFeed`, and clicking the strip pins the panel rather
 * than navigating, so the named session's path has no consumer on that side.
 */

import type { MenuBarIslandState } from '../../shared/menuBarIsland';
import type { StripView } from './stripStateMachine';

/**
 * Sentinel for `lastStripKey` while the island owns the render.
 *
 * The bitmap path uses that field to skip an unchanged image. The island has no
 * image, so it parks a constant there instead -- which is also what makes the
 * tray glyph reset run once per style switch rather than on every repaint.
 */
export const ISLAND_STRIP_KEY = '__island__';

export function toIslandStrip(view: StripView): MenuBarIslandState['strip'] {
  if (view.mode === 'named') {
    return {
      mode: 'named',
      sessionId: view.sessionId,
      title: view.title,
      state: view.state,
      age: view.age,
    };
  }
  return {
    mode: 'counts',
    needsApproval: view.needsApproval,
    needsDecision: view.needsDecision,
    running: view.running,
    failed: view.failed,
    stalled: view.stalled,
    unread: view.unread,
    age: view.age,
  };
}
