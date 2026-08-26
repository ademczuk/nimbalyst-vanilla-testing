// @vitest-environment node
/**
 * The carry is the difference between "compare three designs" and "look up
 * three designs one at a time", and it fails silently: land in the wrong place
 * and the popover still renders a document, just not the part you were reading.
 * Nothing throws and nothing looks broken, which is why the arithmetic is a
 * pure function with a test rather than three lines inside a component.
 */

import { describe, expect, it } from 'vitest';

import {
  carryScrollTop,
  scrollFractionOf,
  scrollTopForFraction,
} from '../artifactScrollCarry';

describe('artifact scroll carry', () => {
  it('lands at the same relative depth in a shorter design', () => {
    // Halfway down a long variant is halfway down a short one -- the whole
    // point of carrying a fraction instead of a pixel offset.
    expect(carryScrollTop(4000, 8000, 2000)).toBe(1000);
  });

  it('lands at the same relative depth in a longer design', () => {
    expect(carryScrollTop(500, 2000, 8000)).toBe(2000);
  });

  it('treats content with nowhere to scroll as the top', () => {
    // A design shorter than the popover has scrollableHeight 0. Dividing by it
    // yields Infinity, and Infinity * 0 is NaN -- which assigned to scrollTop
    // silently pins the next artifact to the top with no way to tell that the
    // carry failed rather than that the reader was at the top.
    expect(scrollFractionOf(0, 0)).toBe(0);
    expect(carryScrollTop(120, 0, 5000)).toBe(0);
    expect(carryScrollTop(4000, 8000, 0)).toBe(0);
  });

  it('clamps a stale fraction rather than scrolling past the end', () => {
    // A fraction captured before a re-measure can exceed 1 if the content
    // shrank. Pinning to the bottom is correct; NaN or a negative is not.
    expect(scrollTopForFraction(1.4, 2000)).toBe(2000);
    expect(scrollTopForFraction(-0.2, 2000)).toBe(0);
    expect(scrollTopForFraction(Number.NaN, 2000)).toBe(0);
  });

  it('survives a scroller that has not been measured yet', () => {
    // Before layout, refs report 0 and a ResizeObserver has not fired. The
    // carry must return a usable number rather than poisoning scrollTop.
    expect(carryScrollTop(Number.NaN, 8000, 2000)).toBe(0);
    expect(carryScrollTop(4000, Number.NaN, 2000)).toBe(0);
    expect(carryScrollTop(4000, 8000, Number.NaN)).toBe(0);
  });
});
