/**
 * Carrying a reader's place from one artifact to the next.
 *
 * This is the detail that makes comparing long designs actually work: expand
 * option A, scroll to the pricing table, step to option B, land on B's pricing
 * table. Without it the popover is three separate lookups and the comparison is
 * happening in memory again -- which is the failure the popover exists to fix.
 *
 * The offset carries as a **fraction of scrollable height**, never as a pixel
 * value. Two variants of a screen are rarely the same length, and 2000px down a
 * 2400px design is near the end of it while 2000px down a 9000px design is
 * barely started. Pixels would land the reader somewhere arbitrary and the
 * feature would read as broken without anyone being able to say why.
 *
 * Kept as a pure function, and tested as one, because it is exactly the kind of
 * arithmetic that regresses invisibly: nothing on screen says "you landed in
 * the wrong place", it just feels wrong.
 */
/**
 * Where a reader is in a scroller, as a fraction in `[0, 1]`.
 *
 * `scrollableHeight` is `scrollHeight - clientHeight`: the distance the
 * scroller can actually travel, not the height of the content. Content shorter
 * than its viewport has nowhere to go, so its fraction is 0 rather than a
 * division by zero.
 */
export declare function scrollFractionOf(scrollTop: number, scrollableHeight: number): number;
/**
 * The same place in a scroller of a different length.
 *
 * Clamped rather than trusted: a fraction stored from one layout and reapplied
 * after a re-measure can exceed 1 if the content shrank between the two, and
 * scrolling past the end silently pins to the bottom in a way that looks like
 * the carry lost the position.
 */
export declare function scrollTopForFraction(fraction: number, scrollableHeight: number): number;
/**
 * The whole carry in one step, for the common case: leaving a scroller of one
 * length and arriving in a scroller of another.
 */
export declare function carryScrollTop(scrollTop: number, fromScrollableHeight: number, toScrollableHeight: number): number;
