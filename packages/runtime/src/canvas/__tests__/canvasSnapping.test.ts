// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  CANVAS_SNAP_GRID,
  snapCanvasDrag,
  snapCanvasNodeToGrid,
  type CanvasSnapNeighbour,
} from '../canvasSnapping';
import type { CanvasAnyNode } from '../CanvasDocument';

function rect(
  id: string,
  x: number,
  y: number,
  width = 100,
  height = 60
): CanvasSnapNeighbour {
  return { id, x, y, width, height };
}

const THRESHOLD = 8;

/**
 * Spacing cases need row-mates the dragged card overlaps on the cross axis but
 * does *not* align with, or the cross axis snaps too and the assertion stops
 * being about spacing. A 100-tall card at y=150 overlaps a 60-tall row at y=100
 * by ten pixels, and its nearest cross-axis pairing is ten away.
 */
const ROW_Y = 100;
const OFF_ROW = { y: 150, height: 100 };

describe('snapCanvasDrag', () => {
  it('takes the nearest of the nine line pairings, and lights every alignment that results', () => {
    // Left edges are 3 apart and that is the only pairing in reach. Landing on
    // it also puts the centres and the right edges together, because the two
    // cards are the same width -- three true alignments, three lines.
    const result = snapCanvasDrag(
      { x: 203, y: 400, width: 100, height: 60 },
      [rect('above', 200, 100)],
      THRESHOLD
    );

    expect(result).toMatchObject({ x: 200, y: 400 });
    expect(result.guides).toEqual([
      { kind: 'edge', x1: 200, y1: 100, x2: 200, y2: 460 },
      { kind: 'center', x1: 250, y1: 100, x2: 250, y2: 460 },
      { kind: 'edge', x1: 300, y1: 100, x2: 300, y2: 460 },
    ]);
  });

  it('spans one guide across every card sitting on that line', () => {
    const result = snapCanvasDrag(
      { x: 204, y: 400, width: 100, height: 60 },
      [rect('top', 200, 100, 40, 60), rect('middle', 200, 180, 40, 60)],
      THRESHOLD
    );

    expect(result.x).toBe(200);
    expect(result.guides).toEqual([
      { kind: 'edge', x1: 200, y1: 100, x2: 200, y2: 460 },
    ]);
  });

  it('leaves an axis alone when nothing is within the threshold', () => {
    const result = snapCanvasDrag(
      { x: 212, y: 400, width: 100, height: 60 },
      [rect('above', 200, 100)],
      THRESHOLD
    );

    expect(result).toEqual({ x: 212, y: 400, guides: [] });
  });

  it('centres a card between two row-mates and measures the two equal gaps', () => {
    // The gap between them runs 200..500; a 100-wide card centred in it leaves
    // 100 a side, so x = 300. No edge or centre alignment is in reach.
    const result = snapCanvasDrag(
      { x: 306, ...OFF_ROW, width: 100 },
      [rect('left', 100, ROW_Y), rect('right', 500, ROW_Y)],
      THRESHOLD
    );

    expect(result.x).toBe(300);
    expect(result.guides).toEqual([
      { kind: 'spacing', x1: 200, y1: 200, x2: 300, y2: 200 },
      { kind: 'spacing', x1: 400, y1: 200, x2: 500, y2: 200 },
    ]);
  });

  it('repeats an existing pair gap to continue a rhythm', () => {
    // 'a' ends at 200 and 'b' starts at 240: a 40 gap. Continuing it past 'b'
    // (which ends at 340) puts the card at 380.
    const result = snapCanvasDrag(
      { x: 376, ...OFF_ROW, width: 100 },
      [rect('a', 100, ROW_Y), rect('b', 240, ROW_Y)],
      THRESHOLD
    );

    expect(result.x).toBe(380);
    expect(result.guides).toEqual([
      { kind: 'spacing', x1: 200, y1: 200, x2: 240, y2: 200 },
      { kind: 'spacing', x1: 340, y1: 200, x2: 380, y2: 200 },
    ]);
  });

  it('ignores cards that are not row-mates, and pairs below three participants', () => {
    const offRow = snapCanvasDrag(
      { x: 306, ...OFF_ROW, width: 100 },
      [rect('left', 100, 900), rect('right', 500, 900)],
      THRESHOLD
    );
    expect(offRow).toEqual({ x: 306, y: 150, guides: [] });

    const lonePair = snapCanvasDrag(
      { x: 306, ...OFF_ROW, width: 100 },
      [rect('left', 100, ROW_Y)],
      THRESHOLD
    );
    expect(lonePair).toEqual({ x: 306, y: 150, guides: [] });
  });

  it('returns integer geometry when a centre alignment lands on a half pixel', () => {
    // The odd-width neighbour's centre is 253.5, so the card's left edge wants
    // 203.5 -- the guide reports the true line, the card lands on an integer.
    const result = snapCanvasDrag(
      { x: 205, y: 400, width: 100, height: 60 },
      [rect('odd', 200, 100, 107, 60)],
      THRESHOLD
    );

    expect(result.x).toBe(204);
    expect(result.guides).toEqual([
      { kind: 'center', x1: 253.5, y1: 100, x2: 253.5, y2: 460 },
    ]);
  });
});

describe('snapCanvasNodeToGrid', () => {
  it('rounds an origin to the grid and returns the same node when already on it', () => {
    const node = {
      id: 'sticky',
      type: 'text',
      x: 128,
      y: 274,
      width: 240,
      height: 180,
      text: '',
    } as CanvasAnyNode;

    expect(snapCanvasNodeToGrid(node)).toMatchObject({
      x: 120,
      y: 280,
      width: 240,
      height: 180,
    });
    expect(CANVAS_SNAP_GRID).toBe(20);

    const aligned = { ...node, x: 120, y: 280 } as CanvasAnyNode;
    expect(snapCanvasNodeToGrid(aligned)).toBe(aligned);
  });
});
