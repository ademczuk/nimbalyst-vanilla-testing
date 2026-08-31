import type { BrowserWindow } from 'electron';

/**
 * The windows created with `transparent: true`, so main-process code that
 * sweeps every window can leave them alone.
 *
 * On macOS `setBackgroundColor` on a transparent window is not a hint -- it
 * makes the window paint that colour edge to edge and there is no way back
 * short of recreating it. `updateWindowTitleBars` used to call it on every
 * window, which turned the 760x460 menu bar island into a dark slab lying over
 * the top of the screen (#4817) on any theme change, including the automatic
 * one a `system` theme takes at sunset. The tray panel loses its `popover`
 * vibrancy the same way.
 *
 * A WeakSet rather than a URL/mode sniff: the window itself is the thing that
 * knows how it was created, and entries drop out when it is destroyed.
 */
const transparentWindows = new WeakSet<BrowserWindow>();

export function markWindowTransparent(window: BrowserWindow): void {
  transparentWindows.add(window);
}

export function isWindowTransparent(window: BrowserWindow): boolean {
  return transparentWindows.has(window);
}
