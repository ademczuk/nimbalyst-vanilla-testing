/**
 * Keeps pin overlay coordinates in step with the rendered mockup.
 *
 * Deliberately free of host APIs: it takes an iframe ref and a pin store, and
 * uses only DOM events, so the web-console mount can reuse it unchanged.
 *
 * Two rates, two passes (see `measureMockupPins.ts`):
 * - RESOLVE (selector queries, healing, computed style) on a content version
 *   bump, a viewport preset change, or a change to the stored pins.
 * - MEASURE (rects only) on scroll inside the frame -- including nested
 *   scrollers, hence capture -- and on a resize of the frame, its content, or
 *   the host window.
 *
 * Scroll never re-queries selectors or reads computed style. The one exception
 * is a resolved element that has left the document since the last resolution:
 * its rect is meaningless, so that forces a re-resolve rather than a stale read.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import {
  EMPTY_PIN_LAYOUT,
  anchorsNeedResolution,
  measureResolvedPins,
  resolveMockupPinAnchors,
  type MockupPinAnchor,
  type MockupPinLayout,
} from "../../comments/measureMockupPins";
import type { MockupPinStore } from "../../comments/mockupPinStore";

export interface UseMockupPinLayoutOptions {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  store: MockupPinStore;
  /**
   * Bumped by the owner AFTER the mockup HTML has been written into the frame.
   * Measuring off the pre-render value would read the previous document.
   */
  contentVersion: number;
  /** Active viewport preset width; null = full width. */
  viewportWidth: number | null;
  enabled?: boolean;
}

function sameLayout(a: MockupPinLayout, b: MockupPinLayout): boolean {
  if (
    a.placements.length !== b.placements.length ||
    a.hidden.length !== b.hidden.length ||
    a.detached.length !== b.detached.length
  ) {
    return false;
  }
  return (
    a.placements.every((placement, index) => {
      const other = b.placements[index];
      return (
        placement.pin === other.pin &&
        placement.status === other.status &&
        placement.left === other.left &&
        placement.top === other.top
      );
    }) &&
    a.hidden.every((pin, index) => pin === b.hidden[index]) &&
    a.detached.every((pin, index) => pin === b.detached[index])
  );
}

export function useMockupPinLayout({
  iframeRef,
  store,
  contentVersion,
  viewportWidth,
  enabled = true,
}: UseMockupPinLayoutOptions): MockupPinLayout {
  const pins = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  const [layout, setLayout] = useState<MockupPinLayout>(EMPTY_PIN_LAYOUT);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const anchorsRef = useRef<readonly MockupPinAnchor[] | null>(null);

  const applyLayout = useCallback((next: MockupPinLayout) => {
    if (sameLayout(layoutRef.current, next)) return;
    layoutRef.current = next;
    setLayout(next);
  }, []);

  const resolveAndMeasure = useCallback(() => {
    const frameDocument = iframeRef.current?.contentDocument;
    if (!enabled || !frameDocument) {
      anchorsRef.current = null;
      applyLayout(EMPTY_PIN_LAYOUT);
      return;
    }
    const anchors = resolveMockupPinAnchors(frameDocument, pins, store);
    anchorsRef.current = anchors;
    applyLayout(measureResolvedPins(frameDocument, anchors));
  }, [applyLayout, enabled, iframeRef, pins, store]);

  const measure = useCallback(() => {
    const frameDocument = iframeRef.current?.contentDocument;
    const anchors = anchorsRef.current;
    if (!enabled || !frameDocument) {
      applyLayout(EMPTY_PIN_LAYOUT);
      return;
    }
    if (!anchors || anchorsNeedResolution(frameDocument, anchors)) {
      resolveAndMeasure();
      return;
    }
    applyLayout(measureResolvedPins(frameDocument, anchors));
  }, [applyLayout, enabled, iframeRef, resolveAndMeasure]);

  useEffect(() => {
    resolveAndMeasure();
    if (!enabled) return;

    const iframe = iframeRef.current;
    const frameDocument = iframe?.contentDocument;
    const frameWindow = iframe?.contentWindow;
    if (!iframe || !frameDocument) return;

    // Capture: a pin can sit inside a nested scroller, whose scroll events do
    // not bubble to the document.
    frameDocument.addEventListener("scroll", measure, true);
    frameWindow?.addEventListener("resize", measure);
    window.addEventListener("resize", measure);

    const observer =
      typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(iframe);
    if (frameDocument.documentElement) {
      observer?.observe(frameDocument.documentElement);
    }

    return () => {
      frameDocument.removeEventListener("scroll", measure, true);
      frameWindow?.removeEventListener("resize", measure);
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
    // `contentVersion` and `viewportWidth` are not read here -- they are the
    // signals that the rendered document changed underneath us, so they must
    // re-run the effect (re-resolve AND re-bind to the new document).
  }, [resolveAndMeasure, measure, enabled, iframeRef, contentVersion, viewportWidth]);

  return layout;
}
