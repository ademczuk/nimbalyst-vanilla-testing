/**
 * Keeps the tracker grid from acting on keystrokes that were never aimed at it.
 *
 * RevoGrid's `revogr-overlay-selection` binds its key handling to a
 * document-level `keydown` listener (bubble phase) and never checks where the
 * event came from. While a cell is selected, that means typing anywhere else in
 * the app is read as grid input: a printable key calls `change(e.key)` and opens
 * the cell editor over the selected cell, so typing a prompt into a dialog
 * overwrites the title of whatever row happened to be selected behind it.
 *
 * `useExtensionInputGuard` does not cover this -- it patches
 * `window.addEventListener`, and RevoGrid registers on `document`. The
 * spreadsheet's `shouldIsolateFromGrid` does not either: it requires each text
 * input to opt in with `stopPropagation`, which an arbitrary dialog elsewhere in
 * the app has no way to know it needs to do.
 *
 * So invert it. Before running its own handler RevoGrid emits a bubbling,
 * cancelable `beforekeydown` carrying the original event, and bails when that
 * proxy is default-prevented. Listening for it on the grid container lets the
 * grid decline keys by origin, in one place, without every input in the app
 * having to defend itself.
 */

import { useEffect, type RefObject } from 'react';

/** The `beforekeydown` payload, narrowed to the part we need. */
export interface GridBeforeKeyDownDetail {
  readonly original?: KeyboardEvent | null;
}

/**
 * Whether the keystroke behind a `beforekeydown` started inside `container`.
 *
 * `composedPath()` is the authoritative answer -- it crosses shadow boundaries,
 * so a key pressed in one of RevoGrid's own inner elements still resolves to the
 * container. It is only readable while the original event is still dispatching,
 * which it is here: `beforekeydown` is emitted synchronously from inside the
 * document-level `keydown` listener. `contains` is the fallback for the
 * light-DOM case where the path is unavailable (jsdom, a replayed event).
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

  const path = typeof original.composedPath === 'function' ? original.composedPath() : [];
  if (path.length > 0) return path.includes(container);

  const target = original.target;
  return target instanceof Node ? container.contains(target) : true;
}

/**
 * Suppress RevoGrid's key handling for keystrokes typed outside `containerRef`.
 *
 * Every mounted overlay emits its own `beforekeydown` for a single keystroke, so
 * this fires several times per key; each emit is cancelled independently.
 */
export function useGridKeyOriginGuard(
  containerRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const onBeforeKeyDown = (event: Event) => {
      const detail = (event as CustomEvent<GridBeforeKeyDownDetail>).detail;
      if (keydownOriginatedInGrid(container, detail?.original)) return;
      event.preventDefault();
    };

    container.addEventListener('beforekeydown', onBeforeKeyDown);
    return () => container.removeEventListener('beforekeydown', onBeforeKeyDown);
  }, [containerRef]);
}
