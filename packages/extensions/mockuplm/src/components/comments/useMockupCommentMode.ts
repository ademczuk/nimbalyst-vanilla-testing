/**
 * Comment-mode pointer behaviour inside the mockup frame: crosshair cursor,
 * hover highlight on the element under the pointer, and a click that captures
 * a descriptive anchor without touching the mockup HTML.
 *
 * Mutual exclusion with Interactive mode is the caller's job -- the same rule
 * element picking already follows, enforced where both toggles live.
 */

import { useEffect, useRef, type RefObject } from "react";
import { capturePinDraft } from "../../comments/capturePinDraft";
import type { MockupPinDraft } from "../../comments/mockupCommentSource";
import { COMMENT_MODE_CLASS, COMMENT_TARGET_CLASS } from "./commentModeStyles";
import { describeViewportWidth } from "../viewportPresets";

/** Where the composer should open, in overlay coordinates. */
export interface MockupPinDraftPlacement {
  draft: MockupPinDraft;
  left: number;
  top: number;
}

export interface UseMockupCommentModeOptions {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  active: boolean;
  /** Re-binds after the mockup HTML is re-rendered into a fresh document. */
  contentVersion: number;
  onPlace: (placement: MockupPinDraftPlacement) => void;
}

export function useMockupCommentMode({
  iframeRef,
  active,
  contentVersion,
  onPlace,
}: UseMockupCommentModeOptions): void {
  const onPlaceRef = useRef(onPlace);
  onPlaceRef.current = onPlace;

  useEffect(() => {
    if (!active) return;
    const iframe = iframeRef.current;
    const frameDocument = iframe?.contentDocument;
    if (!iframe || !frameDocument?.documentElement) return;

    const root = frameDocument.documentElement;
    root.classList.add(COMMENT_MODE_CLASS);

    let highlighted: Element | null = null;
    const highlight = (element: Element | null): void => {
      if (highlighted === element) return;
      highlighted?.classList.remove(COMMENT_TARGET_CLASS);
      highlighted = element;
      highlighted?.classList.add(COMMENT_TARGET_CLASS);
    };

    const elementUnder = (event: Event): Element | null => {
      const target = event.target;
      if (!(target instanceof frameDocument.defaultView!.Element)) return null;
      const tag = target.localName;
      return tag === "html" || tag === "body" ? null : target;
    };

    const handleMove = (event: MouseEvent): void => {
      highlight(elementUnder(event));
    };

    const handleLeave = (): void => highlight(null);

    const handleClick = (event: MouseEvent): void => {
      // Capture phase: the author's own handlers must not see this click, and
      // a link must not navigate the frame out from under the overlay.
      event.preventDefault();
      event.stopPropagation();

      const target = elementUnder(event);
      const width = iframe.clientWidth || frameDocument.documentElement.clientWidth;
      const draft = capturePinDraft({
        document: frameDocument,
        target,
        clientX: event.clientX,
        clientY: event.clientY,
        viewport: { width, label: describeViewportWidth(width) },
      });
      highlight(null);
      onPlaceRef.current({ draft, left: event.clientX, top: event.clientY });
    };

    frameDocument.addEventListener("mousemove", handleMove, true);
    frameDocument.addEventListener("mouseleave", handleLeave, true);
    frameDocument.addEventListener("click", handleClick, true);

    return () => {
      highlight(null);
      root.classList.remove(COMMENT_MODE_CLASS);
      frameDocument.removeEventListener("mousemove", handleMove, true);
      frameDocument.removeEventListener("mouseleave", handleLeave, true);
      frameDocument.removeEventListener("click", handleClick, true);
    };
  }, [active, contentVersion, iframeRef]);
}
