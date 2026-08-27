// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  CANVAS_LOD_POLICY,
  canvasZoomBucket,
  computeCanvasCardLod,
  touchCanvasRecency,
  type CanvasCardLod,
} from '../canvasCardLod';

const CARDS = Array.from({ length: 20 }, (_unused, index) => `card-${index}`);

function lod(
  overrides: Partial<Parameters<typeof computeCanvasCardLod>[0]> = {}
): ReadonlyMap<string, CanvasCardLod> {
  return computeCanvasCardLod({
    candidateIds: CARDS,
    visibleIds: new Set<string>(),
    zoom: 1,
    hotId: null,
    surfaceHidden: false,
    gestureActive: false,
    previous: new Map(),
    recency: [],
    ...overrides,
  });
}

function counts(assignment: ReadonlyMap<string, CanvasCardLod>) {
  const tally: Record<CanvasCardLod, number> = { cold: 0, warm: 0, hot: 0 };
  for (const value of assignment.values()) tally[value] += 1;
  return tally;
}

describe('canvas card LOD', () => {
  it('warms what is visible up to the mount cap and keeps mounted cards mounted', () => {
    const visible = new Set(CARDS);
    const first = lod({ visibleIds: visible });
    // Twenty cards on screen, twelve slots: the cap is the point.
    expect(counts(first)).toEqual({
      cold: CARDS.length - CANVAS_LOD_POLICY.mountCap,
      warm: CANVAS_LOD_POLICY.mountCap,
      hot: 0,
    });

    // A card that scrolls in does not evict one that is already mounted --
    // unmounting is the expensive direction, so the incumbent wins the slot.
    const mounted = CARDS.filter((id) => first.get(id) === 'warm');
    const later = lod({
      visibleIds: visible,
      previous: first,
      recency: touchCanvasRecency([], ['card-19', 'card-18']),
    });
    for (const id of mounted) expect(later.get(id)).toBe('warm');

    // The hot card takes a slot rather than sitting outside the budget: the cap
    // is a cap on mounted third-party React, and hot is the heaviest mount.
    const withHot = lod({ visibleIds: visible, hotId: 'card-19' });
    expect(withHot.get('card-19')).toBe('hot');
    expect(counts(withHot).warm).toBe(CANVAS_LOD_POLICY.mountCap - 1);
  });

  /*
   * The Agent-mode transition. Nimbalyst keeps every mode component mounted and
   * hides the inactive pane with `display: none`, and an element in that subtree
   * measures 0x0 -- so `IntersectionObserver` reports a confident
   * `isIntersecting: false` for every card on the board.
   *
   * Taken at face value that is "cold everything", which unmounts every editor
   * and drops every room each time the user glances at a transcript, and rebuilds
   * them all on the way back. This asserts the frozen behaviour instead, and it
   * asserts it by *identity*: returning the previous map unchanged is the
   * mechanism by which React does not re-render, so `toBe` is the assertion that
   * actually catches a remount storm. `toEqual` would pass on a map that had been
   * rebuilt from scratch.
   */
  it('freezes a hidden surface and returns from hidden without churn', () => {
    const visible = new Set(CARDS.slice(0, 6));
    const onScreen = lod({ visibleIds: visible, hotId: 'card-0' });
    expect(counts(onScreen)).toEqual({ cold: 14, warm: 5, hot: 1 });

    // Switching to Agent mode: the observer insists nothing intersects.
    const hidden = lod({
      visibleIds: new Set<string>(),
      hotId: 'card-0',
      surfaceHidden: true,
      previous: onScreen,
    });
    expect(hidden).toBe(onScreen);

    // Still hidden, and now the zoom bucket has changed too (a resize to 0x0
    // moves the fitted zoom). Nothing may move while hidden.
    expect(
      lod({
        visibleIds: new Set<string>(),
        zoom: 0.1,
        hotId: null,
        surfaceHidden: true,
        previous: hidden,
      })
    ).toBe(onScreen);

    // Back to Files mode. The observer re-reports the same cards, and the board
    // is exactly as it was left -- no unmount, no remount, no reconnect.
    expect(
      lod({ visibleIds: visible, hotId: 'card-0', previous: hidden })
    ).toBe(onScreen);

    // A card deleted while hidden does not linger in the assignment, or it would
    // reappear as a mounted ghost on the next promotion.
    const fewer = computeCanvasCardLod({
      candidateIds: CARDS.filter((id) => id !== 'card-3'),
      visibleIds: new Set<string>(),
      zoom: 1,
      hotId: 'card-0',
      surfaceHidden: true,
      gestureActive: false,
      previous: onScreen,
      recency: [],
    });
    expect(fewer.has('card-3')).toBe(false);
    expect(fewer.get('card-0')).toBe('hot');
  });

  /*
   * Mount and unmount are the only expensive thing a card does. On a board of
   * thirty RevoGrids -- the extension NIM-3845 measured as the worst -- a fast
   * pan that swapped ten cards in and out cost a 120.9 ms worst frame and seven
   * dropped frames out of seventy-nine, while the same gesture over all-cold
   * cards, and twelve mounted cards not churning, both ran flat at 16.7 ms. So
   * the churn waits for the user to stop moving.
   */
  it('does not promote or demote mid-gesture', () => {
    const settled = lod({ visibleIds: new Set(CARDS.slice(0, 4)) });
    const panning = lod({
      visibleIds: new Set(CARDS.slice(10, 16)),
      gestureActive: true,
      previous: settled,
    });
    expect(panning).toBe(settled);

    // The gesture ends and the board catches up in one step.
    const after = lod({
      visibleIds: new Set(CARDS.slice(10, 16)),
      previous: settled,
    });
    expect(CARDS.slice(10, 16).every((id) => after.get(id) === 'warm')).toBe(
      true
    );
    expect(CARDS.slice(0, 4).every((id) => after.get(id) === 'cold')).toBe(
      true
    );
  });

  it('goes cold when zoomed out, with hysteresis across the threshold', () => {
    const visible = new Set(CARDS.slice(0, 4));
    const warm = lod({ visibleIds: visible });
    expect(counts(warm).warm).toBe(4);

    // Well below the cold threshold: a 13px label paints at 4px, so nothing is
    // worth mounting.
    const cold = lod({ visibleIds: visible, zoom: 0.2, previous: warm });
    expect(counts(cold)).toEqual({ cold: CARDS.length, warm: 0, hot: 0 });

    // In the band between the two thresholds the board keeps the regime it is
    // in, so resting the viewport near the threshold cannot mount and unmount
    // the board on every wheel tick.
    const between =
      (CANVAS_LOD_POLICY.warmAboveZoom + CANVAS_LOD_POLICY.coldBelowZoom) / 2;
    expect(
      counts(lod({ visibleIds: visible, zoom: between, previous: warm })).warm
    ).toBe(4);
    expect(
      counts(lod({ visibleIds: visible, zoom: between, previous: cold })).warm
    ).toBe(0);

    // The bucket is what the surface subscribes to, and it must land inside the
    // regime it stands in for -- otherwise the quantisation would change the
    // answer rather than just reduce how often it is recomputed.
    expect(canvasZoomBucket(1)).toBe(1);
    expect(canvasZoomBucket(0.99)).toBe(1);
    expect(canvasZoomBucket(1.4)).toBe(CANVAS_LOD_POLICY.warmAboveZoom);
    expect(canvasZoomBucket(0.2)).toBe(0);
    expect(canvasZoomBucket(0.4)).toBe(between);
  });
});
