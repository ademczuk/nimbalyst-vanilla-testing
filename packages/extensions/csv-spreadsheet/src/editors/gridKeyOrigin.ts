/**
 * Keeps the spreadsheet from acting on keystrokes that were never aimed at it.
 *
 * RevoGrid's `revogr-overlay-selection` binds its key handling to a
 * document-level `keydown` listener (bubble phase) and never checks where the
 * event came from. While a cell is focused, that means typing anywhere else in
 * the app is read as grid input: `KeyboardService.keyDown` calls
 * `change(e.key)` for any single-character key, which opens the cell editor and
 * pulls focus out of whatever the user was actually typing into. Opening quick
 * open over a CSV tab and typing "document" landed only the "d".
 *
 * `shouldIsolateFromGrid` does not cover this. It requires each text input to
 * opt in with `stopPropagation`, which it can only do for inputs this extension
 * owns -- quick open, and every other surface elsewhere in the app, has no way
 * to know it needs to defend itself.
 *
 * So invert it. Before running its own handler RevoGrid emits a bubbling,
 * composed, cancelable `beforekeydown` carrying the original event, and bails
 * when that proxy is default-prevented. Listening for it lets the grid decline
 * keys by origin, in one place.
 *
 * The tracker grid solves the same RevoGrid problem in
 * `collab-client/src/trackers-ui/grid/gridKeyOrigin.ts`. This extension ships as
 * its own bundle and does not depend on that package, so the logic is restated
 * here rather than shared.
 */

import { useEffect, type RefObject } from 'react';

/** The `beforekeydown` payload, narrowed to the part we need. */
export interface GridBeforeKeyDownDetail {
  readonly original?: KeyboardEvent | null;
}

/**
 * Whether `event` passed through `container`, or `undefined` when it cannot be
 * placed at all.
 *
 * `composedPath()` is the authoritative answer -- it crosses shadow boundaries,
 * so a key pressed in one of RevoGrid's own inner elements still resolves to the
 * container. It is only readable while the event is still dispatching, which it
 * is at both call sites here. `contains` is the fallback for the light-DOM case
 * where the path is unavailable (jsdom, a replayed event).
 */
function eventPathIncludes(container: Node, event: Event): boolean | undefined {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  if (path.length > 0) return path.includes(container);

  const target = event.target;
  return target instanceof Node ? container.contains(target) : undefined;
}

/**
 * Whether the keystroke behind a `beforekeydown` started inside `container`.
 *
 * An event we cannot place is treated as in-grid. Guessing "outside" would
 * silently disable the grid's own arrow-key navigation, which is a worse failure
 * than the one this guards against.
 */
export function keydownOriginatedInGrid(
  container: Node,
  original: Event | null | undefined,
): boolean {
  if (!original) return true;
  return eventPathIncludes(container, original) ?? true;
}

/**
 * Suppress RevoGrid's key handling for keystrokes typed outside `containerRef`.
 *
 * Anchor this at the editor root rather than the grid viewport: the formula bar
 * and find bar are legitimate spreadsheet input, and they already keep their own
 * unmodified keys away from the grid with `shouldIsolateFromGrid`. Narrowing the
 * boundary to the viewport would additionally strip the modified keystrokes they
 * deliberately let through.
 *
 * The listener sits on `document` and resolves the container per event rather
 * than binding to `containerRef.current` on mount: the editor renders a loading
 * tree first, so the ref is still null when the effect runs and would never be
 * rebound. Reaching `document` is safe because `beforekeydown` is composed and
 * bubbling; the container check on the proxy itself is what keeps this instance
 * from answering for some other RevoGrid on screen.
 *
 * Every mounted overlay emits its own `beforekeydown` for a single keystroke, so
 * this fires several times per key; each emit is cancelled independently.
 */
export function useGridKeyOriginGuard(
  containerRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const onBeforeKeyDown = (event: Event) => {
      const container = containerRef.current;
      if (!container) return;
      if (eventPathIncludes(container, event) !== true) return;

      const detail = (event as CustomEvent<GridBeforeKeyDownDetail>).detail;
      if (keydownOriginatedInGrid(container, detail?.original)) return;
      event.preventDefault();
    };

    document.addEventListener('beforekeydown', onBeforeKeyDown);
    return () => document.removeEventListener('beforekeydown', onBeforeKeyDown);
  }, [containerRef]);
}
