/**
 * A full-size, interactive artifact in a box big enough to read it.
 *
 * The sibling of `ScaledPreviewFrame`, and a deliberate reversal of it. That
 * component exists to make a 1000px document recognisable in a 128px panel, and
 * everything it does follows from that: scale the whole thing down, take
 * `pointer-events` away so a click cannot land in a mockup instead of on the
 * card, and `aria-hidden` it so a screen reader is not walked through a
 * shrunken copy of an entire document.
 *
 * None of those reasons survive here. The content is full-size, it is the only
 * thing on screen, and reaching it is the entire point. So this is a separate
 * component rather than a prop on that one -- the two disagree about what a
 * preview is for, and a flag would let the popover's answer leak back into the
 * card, where it is wrong.
 *
 * ## Scrolling is the editor's, not ours
 *
 * There is no scroller in this component, and that is the correct design rather
 * than an omission. A mockup paints into an iframe sized `w-full h-full` inside
 * an `overflow-hidden` box, so it fills whatever it is given and scrolls its
 * own document. Wrapping that in an outer scroller would produce a box that
 * cannot scroll around content that scrolls itself -- two scroll models fighting
 * over one wheel event.
 *
 * This is why the plan's requirement that scrolling be native is met by
 * *removing* the scale trick rather than by rebuilding it: at scale 1 the
 * editor already scrolls natively, in real coordinates, with correct wheel
 * deltas and correct scrollbar travel.
 *
 * ## Scaling, and what it costs
 *
 * Scaling applies only when the box is narrower than the artifact's authored
 * width -- a narrow window, not the common case. It is a real trade: inside a
 * scaled layer the editor's own scrolling happens in scaled coordinates, so a
 * wheel notch travels less than it should. That is worse than native scrolling
 * and better than a horizontal scrollbar under a design squeezed to half its
 * width, which is the only alternative.
 */

import React, { useEffect, useRef, useState } from 'react';

import { PREVIEW_AUTHORED_WIDTH } from './ScaledPreviewFrame';

export interface ArtifactViewportProps {
  children: React.ReactNode;
  /** Overridden only where an artifact type composes at a different width. */
  authoredWidth?: number;
}

export const ArtifactViewport: React.FC<ArtifactViewportProps> = ({
  children,
  authoredWidth = PREVIEW_AUTHORED_WIDTH,
}) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const box = entry?.contentRect;
      if (box) setSize({ width: box.width, height: box.height });
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  // Never above 1: a design authored for 1000px in a 1600px popover should sit
  // at its natural size, not be stretched into a shape nobody designed.
  const scale = size ? Math.min(1, size.width / authoredWidth) : 1;
  const scaled = scale < 1;

  return (
    <div
      ref={hostRef}
      data-testid="feedback-artifact-viewport"
      data-scaled={scaled || undefined}
      className="feedback-artifact-viewport relative h-full w-full overflow-hidden bg-nim"
    >
      {/* Unscaled is the common case and gets no wrapper at all, so the editor
          sizes to this box directly and its own scroller is the real one. */}
      {!scaled || !size ? (
        <div className="absolute inset-0">{children}</div>
      ) : (
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{
            // Laid out at authored width, then scaled to fit. The height is
            // divided by the same factor so the child still receives exactly
            // one boxful, rather than a short box with its bottom cropped.
            width: authoredWidth,
            height: size.height / scale,
            transform: `scale(${scale})`,
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
};
