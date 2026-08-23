/**
 * Floating config for a menu panel that must stay reachable inside the viewport.
 *
 * `flip` and `shift` cannot rescue a panel that is taller than the viewport:
 * shift clamps it against the top padding and the overflowing tail simply paints
 * past the bottom edge with no way to reach it. A workspace with many tracker
 * types pushes the card context menu's "Set Status" submenu well past 30 entries,
 * which is exactly that case.
 *
 * `size()` is the piece that fixes it — it measures the space actually left after
 * flip/shift have run and writes a `maxHeight` onto the panel, which turns the
 * panel's `overflow-y-auto` into a real scrollbar. Callers must set that overflow
 * class themselves; a max height with no overflow rule just clips.
 *
 * `autoUpdate` keeps the cap honest while the menu is open, since the window can
 * be resized (or the traffic-light band can appear) underneath it.
 */

import {
  useFloating,
  offset,
  flip,
  shift,
  size,
  autoUpdate,
  type Placement,
  type UseFloatingReturn,
} from '@floating-ui/react';
import {
  windowControlsClearance,
  type WindowControlsClearanceData,
} from './windowControlsClearance';

/**
 * Never shrink a menu below this. A panel squeezed into 20px is unusable in a
 * different way than one that overflows, and it hides the fact that the anchor
 * itself is in a bad spot — better to overflow slightly and stay legible.
 */
export const SCROLLABLE_MENU_MIN_HEIGHT = 120;

/** Gap between the anchor and the panel, and between the panel and the viewport edge. */
const MENU_OFFSET = 2;
const VIEWPORT_PADDING = 8;

/**
 * `useFloating` for a menu/submenu panel, capped to the viewport and scrollable.
 *
 * Middleware order is load-bearing: `windowControlsClearance` runs after `shift`
 * (it corrects what shift clamps into the OS traffic-light band) and before
 * `size`, so the height it costs us is subtracted from the space `size` hands out
 * rather than being double-counted.
 */
export function useScrollableMenuFloating(
  placement: Placement = 'right-start',
): UseFloatingReturn {
  return useFloating({
    placement,
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(MENU_OFFSET),
      flip({ padding: VIEWPORT_PADDING }),
      shift({ padding: VIEWPORT_PADDING }),
      windowControlsClearance(),
      size({
        padding: VIEWPORT_PADDING,
        apply({ availableHeight, middlewareData, elements }) {
          const pushed = (
            middlewareData.windowControlsClearance as WindowControlsClearanceData | undefined
          )?.pushed ?? 0;
          const usable = Math.max(SCROLLABLE_MENU_MIN_HEIGHT, availableHeight - pushed);
          elements.floating.style.maxHeight = `${usable}px`;
        },
      }),
    ],
  });
}
