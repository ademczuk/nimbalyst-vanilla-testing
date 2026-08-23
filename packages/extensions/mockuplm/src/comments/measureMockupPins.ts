/**
 * Turn stored pins into overlay coordinates against a rendered mockup
 * document. Pure DOM in, plain numbers out -- no React, no Electron, no
 * iframe-lifecycle knowledge -- so the same functions serve the desktop
 * overlay and the web console.
 *
 * The work is split in two on purpose, because they run at very different
 * rates:
 *
 * - `resolveMockupPinAnchors` queries selectors, heals broken ones, and walks
 *   ancestors reading computed style to decide "hidden". It runs only when the
 *   document itself could have changed: a content version bump or a viewport
 *   preset change.
 * - `measureResolvedPins` reads `getBoundingClientRect` on targets that are
 *   already resolved. It runs on scroll and resize, where a forced style
 *   recalc per ancestor per pin would be a visible jank source on a long
 *   mockup with a realistic number of pins.
 *
 * Coordinates are px relative to the iframe's top-left, which is exactly the
 * overlay's own coordinate space: the overlay is stretched over the iframe's
 * box, and `getBoundingClientRect()` inside the frame is already relative to
 * that same box (it accounts for the frame's own scrolling).
 */

import { resolveAndHealMockupPin } from "./resolveMockupPin";
import type { MockupPinResolutionStatus } from "./resolveMockupPin";
import type { MockupPinSnapshot } from "./mockupPinRepository";
import type { MockupPinStore } from "./mockupPinStore";

/** One pin's resolution, held between measurements. */
export interface MockupPinAnchor {
  pin: MockupPinSnapshot;
  status: MockupPinResolutionStatus;
  target: Element | null;
  referenceBox: "element" | "document";
}

export interface MockupPinPlacement {
  pin: MockupPinSnapshot;
  /** 'healed' pins render identically; the distinction is for the panel. */
  status: "attached" | "healed";
  left: number;
  top: number;
}

export interface MockupPinLayout {
  placements: readonly MockupPinPlacement[];
  /**
   * The target exists in the HTML but is not currently rendered (`hidden`,
   * `display: none`, `visibility: hidden`). Collapsed into a count badge --
   * never drawn at a stale coordinate, and never confused with detached.
   */
  hidden: readonly MockupPinSnapshot[];
  /** The anchor could not be re-found honestly. Belongs in the panel's tray. */
  detached: readonly MockupPinSnapshot[];
}

export const EMPTY_PIN_LAYOUT: MockupPinLayout = Object.freeze({
  placements: Object.freeze([]),
  hidden: Object.freeze([]),
  detached: Object.freeze([]),
});

function scrollOffset(document: Document): { x: number; y: number } {
  const root = document.documentElement;
  return {
    x: root?.scrollLeft || document.body?.scrollLeft || 0,
    y: root?.scrollTop || document.body?.scrollTop || 0,
  };
}

function documentBox(document: Document): { width: number; height: number } {
  const root = document.documentElement;
  return {
    width: root?.scrollWidth || document.body?.scrollWidth || 0,
    height: root?.scrollHeight || document.body?.scrollHeight || 0,
  };
}

/**
 * The expensive pass: match selectors, persist a unique heal, and decide
 * attached / hidden / detached. Run this when the document could have changed,
 * never on scroll.
 */
export function resolveMockupPinAnchors(
  document: Document | null | undefined,
  pins: readonly MockupPinSnapshot[],
  store: Pick<MockupPinStore, "updateSelector">
): readonly MockupPinAnchor[] {
  if (!document || pins.length === 0) return [];

  return pins.map((pin) => {
    const resolution = resolveAndHealMockupPin(document, pin, store);
    return {
      pin,
      status: resolution.status,
      target: resolution.target,
      referenceBox: resolution.referenceBox,
    };
  });
}

/**
 * True when a previously resolved target has left the document, so its rect
 * would be meaningless. Node containment only -- no style reads, no queries --
 * so this is safe to call on every scroll before deciding to re-measure.
 */
export function anchorsNeedResolution(
  document: Document | null | undefined,
  anchors: readonly MockupPinAnchor[]
): boolean {
  if (!document) return false;
  return anchors.some(
    (anchor) => anchor.target !== null && !document.contains(anchor.target)
  );
}

/** The cheap pass: rects for targets that are already resolved. */
export function measureResolvedPins(
  document: Document | null | undefined,
  anchors: readonly MockupPinAnchor[]
): MockupPinLayout {
  if (!document || anchors.length === 0) return EMPTY_PIN_LAYOUT;

  const placements: MockupPinPlacement[] = [];
  const hidden: MockupPinSnapshot[] = [];
  const detached: MockupPinSnapshot[] = [];
  let scroll: { x: number; y: number } | null = null;

  for (const anchor of anchors) {
    if (anchor.status === "hidden") {
      hidden.push(anchor.pin);
      continue;
    }
    if (anchor.status === "detached") {
      detached.push(anchor.pin);
      continue;
    }

    if (anchor.referenceBox === "document") {
      const box = documentBox(document);
      scroll ??= scrollOffset(document);
      placements.push({
        pin: anchor.pin,
        status: "attached",
        left: anchor.pin.offset.xPct * box.width - scroll.x,
        top: anchor.pin.offset.yPct * box.height - scroll.y,
      });
      continue;
    }

    if (!anchor.target) {
      detached.push(anchor.pin);
      continue;
    }
    const rect = anchor.target.getBoundingClientRect();
    placements.push({
      pin: anchor.pin,
      status: anchor.status === "healed" ? "healed" : "attached",
      left: rect.left + anchor.pin.offset.xPct * rect.width,
      top: rect.top + anchor.pin.offset.yPct * rect.height,
    });
  }

  return { placements, hidden, detached };
}
