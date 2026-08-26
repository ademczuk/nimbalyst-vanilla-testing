/**
 * Renders a full-size document inside a card-sized box.
 *
 * The problem this solves is specific. An option card's preview panel is 128px
 * tall, and the artifacts people put in one -- mockups, documents -- are
 * authored for a full window. Mounting such a thing at natural size in a small
 * box does not "shrink" it; it shows the top-left corner, which is usually a
 * header and tells you nothing about which design you are looking at.
 *
 * So the child renders at its authored width in an off-flow layer and the whole
 * layer is scaled down to fit. Three consequences worth stating:
 *
 * - **`pointer-events: none`.** A scaled document is not a document you can
 *   use; letting clicks land inside it would mean a click that sometimes
 *   selects the option and sometimes does something inside a mockup. Expanding
 *   is what interaction with a preview means.
 * - **`aria-hidden`.** The preview is decorative. The option's real label and
 *   the artifact's own name are already in the card's accessible name, and a
 *   screen reader walking a scaled-down copy of an entire document would be
 *   worse than silence.
 * - **The scale is measured, not assumed.** The card is grid-sized and the grid
 *   is container-query responsive, so the width is not knowable up front.
 */
import React from 'react';
/**
 * The width previews are composed at.
 *
 * Lowered from 1000 to 800 after measuring the real thing: at 1000 a card was
 * scaling a design to 0.29 and rendering its content ten pixels tall, which is
 * a smudge rather than a recognisable layout. Every 100px shaved here is scale
 * handed back to the reader.
 *
 * 800 rather than lower because it has to stay a *desktop* width. The common
 * responsive breakpoint is 768px, so composing much below this starts tripping
 * designs into their mobile layout -- and a preview that shows a different
 * layout than the artifact is worse than a small one, because nothing on screen
 * says it lied.
 */
export declare const PREVIEW_AUTHORED_WIDTH = 800;
export interface ScaledPreviewFrameProps {
    children: React.ReactNode;
    /** Overridden only where an artifact type composes at a different width. */
    authoredWidth?: number;
}
export declare const ScaledPreviewFrame: React.FC<ScaledPreviewFrameProps>;
