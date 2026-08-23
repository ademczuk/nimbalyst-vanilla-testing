// @vitest-environment node

/**
 * The board's columns are virtualized, so the drag handlers only ever see the
 * handful of cards mounted near the viewport. Every case here is one where
 * reading the index from sibling order -- which is what the unvirtualized board
 * did -- silently drops the card in the wrong place.
 */

import { describe, expect, it } from 'vitest';
import { resolveDropIndex, type KanbanCardHit } from '../kanbanDragListeners';

const CARD_HEIGHT = 80;

/** A window of mounted cards starting at `startIndex`, laid out from y=0. */
function mountedWindow(startIndex: number, count: number): KanbanCardHit[] {
  return Array.from({ length: count }, (_, i) => ({
    dataset: { cardIndex: String(startIndex + i) },
    getBoundingClientRect: () => ({ top: i * CARD_HEIGHT, height: CARD_HEIGHT }),
  }));
}

describe('resolveDropIndex', () => {
  it('returns the column index, not the position among mounted cards', () => {
    // Scrolled deep into a 2,600-card lane: cards 1200..1204 are mounted.
    const cards = mountedWindow(1200, 5);

    // Above the midpoint of the third mounted card -> item 1202, not item 2.
    expect(resolveDropIndex(cards, 2 * CARD_HEIGHT + 10)).toBe(1202);
  });

  it('drops after the last mounted card, not at the end of the whole column', () => {
    const cards = mountedWindow(1200, 5);

    // Below everything rendered. The column continues past 1204, but the
    // pointer is here, so the drop belongs here.
    expect(resolveDropIndex(cards, 5 * CARD_HEIGHT + 999)).toBe(1205);
  });

  it('drops at the top when the pointer is above the first mounted card', () => {
    expect(resolveDropIndex(mountedWindow(0, 3), -50)).toBe(0);
  });

  it('drops at index 0 in an empty column', () => {
    expect(resolveDropIndex([], 120)).toBe(0);
  });

  it('falls back to sibling order for a card rendered without an index', () => {
    const cards: KanbanCardHit[] = [
      { dataset: {}, getBoundingClientRect: () => ({ top: 0, height: CARD_HEIGHT }) },
      { dataset: {}, getBoundingClientRect: () => ({ top: CARD_HEIGHT, height: CARD_HEIGHT }) },
    ];

    expect(resolveDropIndex(cards, CARD_HEIGHT + 10)).toBe(1);
    expect(resolveDropIndex(cards, 5 * CARD_HEIGHT)).toBe(2);
  });

  it('treats a keepMounted card scrolled far above as a miss, not a drop target', () => {
    // virtua pins the dragged card; it renders in index order but way off
    // screen, so its rect must not swallow a drop meant for the viewport.
    const dragged: KanbanCardHit = {
      dataset: { cardIndex: '4' },
      getBoundingClientRect: () => ({ top: -9000, height: CARD_HEIGHT }),
    };

    expect(resolveDropIndex([dragged, ...mountedWindow(1200, 3)], CARD_HEIGHT + 10)).toBe(1201);
  });
});
