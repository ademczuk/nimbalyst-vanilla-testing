/**
 * Turn a click inside the rendered mockup into a descriptive pin anchor.
 *
 * Nothing here writes to the mockup HTML -- the anchor is a description of
 * what was clicked, captured once, and re-resolved on every later render.
 * Clicking background whitespace yields a free pin (`selector: null`) measured
 * against the document box instead of an element box.
 */

import { generateSelector } from "../utils/generateSelector";
import { createLabelSnapshot } from "./resolveMockupPin";
import type { MockupPinDraft } from "./mockupCommentSource";

export interface CapturePinDraftInput {
  document: Document;
  /** The element under the pointer, or null/html/body for whitespace. */
  target: Element | null;
  /** Pointer position in the mockup frame's client coordinates. */
  clientX: number;
  clientY: number;
  viewport: { width: number; label: string };
}

function ratio(distance: number, size: number): number {
  if (!Number.isFinite(size) || size <= 0) return 0.5;
  return Math.min(1, Math.max(0, distance / size));
}

function isBackground(target: Element | null): boolean {
  if (!target) return true;
  const tag = target.localName;
  return tag === "html" || tag === "body";
}

export function capturePinDraft({
  document,
  target,
  clientX,
  clientY,
  viewport,
}: CapturePinDraftInput): MockupPinDraft {
  if (isBackground(target)) {
    const root = document.documentElement;
    const width = root?.scrollWidth || document.body?.scrollWidth || 0;
    const height = root?.scrollHeight || document.body?.scrollHeight || 0;
    const scrollX = root?.scrollLeft || document.body?.scrollLeft || 0;
    const scrollY = root?.scrollTop || document.body?.scrollTop || 0;
    return {
      selector: null,
      labelSnapshot: "",
      offset: {
        xPct: ratio(clientX + scrollX, width),
        yPct: ratio(clientY + scrollY, height),
      },
      viewport: { ...viewport },
    };
  }

  const element = target as Element;
  const rect = element.getBoundingClientRect();
  return {
    selector: generateSelector(element),
    labelSnapshot: createLabelSnapshot(element),
    offset: {
      xPct: ratio(clientX - rect.left, rect.width),
      yPct: ratio(clientY - rect.top, rect.height),
    },
    viewport: { ...viewport },
  };
}
