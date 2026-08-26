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
import React from 'react';
export interface ArtifactViewportProps {
    children: React.ReactNode;
    /** Overridden only where an artifact type composes at a different width. */
    authoredWidth?: number;
}
export declare const ArtifactViewport: React.FC<ArtifactViewportProps>;
