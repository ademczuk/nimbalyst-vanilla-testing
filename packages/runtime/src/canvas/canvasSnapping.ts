/**
 * Magnetic alignment for a dragged canvas card.
 *
 * Pure geometry on purpose. A guide is one SVG line, so its correctness is
 * entirely in the numbers behind it -- the alignment and equal-spacing cases are
 * fiddly, invisible to a reader, and untestable through the DOM. Everything that
 * decides *where the card lands* lives here; the surface only observes a drag and
 * draws what comes back.
 *
 * **The grid is not implemented here.** React Flow snaps a dragged node's
 * position to `snapGrid` before it emits a position change, so by the time this
 * function runs the incoming position is already on the grid and any alignment
 * match is a deliberate override of it. A second grid implementation that
 * disagreed with React Flow's by one rounding step would be worse than none.
 * `snapCanvasNodeToGrid` exists only for the one case React Flow does not cover:
 * a card created from the toolbar, which never goes through a drag.
 *
 * **Guides are transient view state and never touch the document.** They are
 * returned alongside the position rather than stored, so there is no path by
 * which one reaches the Y.Doc, the file, or undo history.
 */
import { toCanvasCoordinate, type CanvasAnyNode } from './CanvasDocument';

/** Grid pitch in canvas units. Matches the surface's dot background. */
export const CANVAS_SNAP_GRID = 20;

/**
 * Alignment reach in *screen* pixels, not canvas units.
 *
 * The pull has to feel identical at every zoom, so the surface divides this by
 * the current scale before calling in. A threshold in canvas units would be
 * unusable at 10% zoom (an 8px reach covering 80 screen pixels) and unreachable
 * at 200%.
 *
 * **It must stay larger than half the grid step, and that is not a style
 * choice.** React Flow quantises the drag to `snapGrid` before this function
 * ever sees it, so the position handed in is up to `CANVAS_SNAP_GRID / 2` away
 * from where the pointer actually is. A neighbour edge sitting off-grid -- the
 * centre line of a 300-wide card, say -- would then be rounded out of reach and
 * the card would simply refuse to line up, with nothing on screen to explain
 * why. Twelve leaves two pixels of slack over the ten the grid can eat.
 */
export const CANVAS_SNAP_THRESHOLD_PX = 12;

/** Coordinates are integers or halves of integers; nothing finer can occur. */
const EPSILON = 0.01;

export interface CanvasSnapRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasSnapNeighbour extends CanvasSnapRect {
  id: string;
}

/**
 * `edge` -- a left/right/top/bottom edge met a neighbour's.
 * `center` -- both centre lines met.
 * `spacing` -- a measure bar over one of two equal gaps.
 */
export type CanvasGuideKind = 'edge' | 'center' | 'spacing';

/**
 * One line to draw, in canvas coordinates.
 *
 * Deliberately two endpoints rather than an axis plus an offset: an alignment
 * guide runs across the axis it snapped on and a spacing bar runs along it, and
 * a single endpoint pair lets the surface render both with the same `<line>`.
 */
export interface CanvasGuide {
  kind: CanvasGuideKind;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface CanvasSnapResult {
  /** Integer canvas coordinates, already through `toCanvasCoordinate`. */
  x: number;
  y: number;
  guides: CanvasGuide[];
}

type Axis = 'x' | 'y';

const SIZE_KEY: Record<Axis, 'width' | 'height'> = {
  x: 'width',
  y: 'height',
};
const CROSS_AXIS: Record<Axis, Axis> = { x: 'y', y: 'x' };

/** Start, centre, end of `rect` along `axis`. */
function linesOf(rect: CanvasSnapRect, axis: Axis): [number, number, number] {
  const start = rect[axis];
  const size = rect[SIZE_KEY[axis]];
  return [start, start + size / 2, start + size];
}

function startOf(rect: CanvasSnapRect, axis: Axis): number {
  return rect[axis];
}

function endOf(rect: CanvasSnapRect, axis: Axis): number {
  return rect[axis] + rect[SIZE_KEY[axis]];
}

function near(left: number, right: number): boolean {
  return Math.abs(left - right) < EPSILON;
}

/**
 * Snap a dragged card to its neighbours and report the guides to draw.
 *
 * Per axis, in order: an edge or centre alignment with any neighbour wins; if
 * none is in reach, an equal-spacing placement among the card's row-mates wins;
 * otherwise the axis is left where the drag put it. The two axes are decided
 * independently, so a card can align on one and space on the other.
 */
export function snapCanvasDrag(
  moving: CanvasSnapRect,
  neighbours: readonly CanvasSnapNeighbour[],
  threshold: number
): CanvasSnapResult {
  const resolved: Record<Axis, AxisSnap | null> = {
    x: resolveAxis(moving, neighbours, 'x', threshold),
    y: resolveAxis(moving, neighbours, 'y', threshold),
  };

  // Guides are computed against the *unrounded* snapped rect so that an exact
  // centre alignment on a half pixel still reports the alignment it made. The
  // returned position is rounded because JSON Canvas geometry is integral; the
  // guide can therefore sit up to half a canvas pixel off the card's final edge,
  // which is invisible and far better than losing the guide entirely.
  const snapped: CanvasSnapRect = {
    ...moving,
    x: moving.x + (resolved.x?.delta ?? 0),
    y: moving.y + (resolved.y?.delta ?? 0),
  };

  const guides: CanvasGuide[] = [];
  for (const axis of ['x', 'y'] as const) {
    const snap = resolved[axis];
    if (!snap) continue;
    if (snap.gaps) guides.push(...spacingGuides(snapped, axis, snap.gaps));
    else guides.push(...alignmentGuides(snapped, neighbours, axis));
  }

  return {
    x: toCanvasCoordinate(snapped.x),
    y: toCanvasCoordinate(snapped.y),
    guides,
  };
}

/** Round one node's origin to the grid, leaving its size alone. */
export function snapCanvasNodeToGrid<T extends CanvasAnyNode>(node: T): T {
  const x = toCanvasCoordinate(
    Math.round(node.x / CANVAS_SNAP_GRID) * CANVAS_SNAP_GRID
  );
  const y = toCanvasCoordinate(
    Math.round(node.y / CANVAS_SNAP_GRID) * CANVAS_SNAP_GRID
  );
  return x === node.x && y === node.y ? node : { ...node, x, y };
}

// ---------------------------------------------------------------------------
// Per-axis resolution
// ---------------------------------------------------------------------------

interface AxisSnap {
  delta: number;
  /** Present only for an equal-spacing snap: the two gaps, in axis coordinates. */
  gaps?: ReadonlyArray<{ start: number; end: number }>;
}

function resolveAxis(
  moving: CanvasSnapRect,
  neighbours: readonly CanvasSnapNeighbour[],
  axis: Axis,
  threshold: number
): AxisSnap | null {
  const alignment = alignAxis(moving, neighbours, axis, threshold);
  if (alignment !== null) return { delta: alignment };
  return spaceAxis(moving, neighbours, axis, threshold);
}

/** The smallest in-reach delta that puts one of the card's three lines on a neighbour's. */
function alignAxis(
  moving: CanvasSnapRect,
  neighbours: readonly CanvasSnapNeighbour[],
  axis: Axis,
  threshold: number
): number | null {
  const movingLines = linesOf(moving, axis);
  let best: number | null = null;
  for (const neighbour of neighbours) {
    for (const target of linesOf(neighbour, axis)) {
      for (const line of movingLines) {
        const delta = target - line;
        if (Math.abs(delta) > threshold) continue;
        if (best === null || Math.abs(delta) < Math.abs(best)) best = delta;
      }
    }
  }
  return best;
}

/**
 * Equal-spacing placement among the card's row-mates.
 *
 * Row-mates are the neighbours that overlap the card on the *other* axis -- the
 * cards a human would say are in the same row (or column). Three participants
 * minimum, because "equal spacing" between two things is meaningless.
 *
 * Two placements are offered, and they are the two a person actually reaches
 * for: centre the card in an existing gap, or continue an existing rhythm by
 * repeating a neighbouring pair's gap on either side of them.
 */
function spaceAxis(
  moving: CanvasSnapRect,
  neighbours: readonly CanvasSnapNeighbour[],
  axis: Axis,
  threshold: number
): AxisSnap | null {
  const cross = CROSS_AXIS[axis];
  const mates = neighbours
    .filter(
      (neighbour) =>
        Math.min(endOf(moving, cross), endOf(neighbour, cross)) -
          Math.max(startOf(moving, cross), startOf(neighbour, cross)) >
        0
    )
    .sort((left, right) => left[axis] - right[axis]);
  if (mates.length < 2) return null;

  const size = moving[SIZE_KEY[axis]];
  let best: AxisSnap | null = null;
  const consider = (
    start: number,
    gaps: ReadonlyArray<{ start: number; end: number }>
  ): void => {
    const delta = start - moving[axis];
    if (Math.abs(delta) > threshold) return;
    if (best !== null && Math.abs(delta) >= Math.abs(best.delta)) return;
    best = { delta, gaps };
  };

  for (let index = 0; index + 1 < mates.length; index += 1) {
    const before = mates[index];
    const after = mates[index + 1];
    const gapStart = endOf(before, axis);
    const gapEnd = startOf(after, axis);
    const gap = gapEnd - gapStart;
    if (gap < 0) continue;

    // Centre the card in the gap the two of them leave.
    if (gap >= size) {
      const start = gapStart + (gap - size) / 2;
      consider(start, [
        { start: gapStart, end: start },
        { start: start + size, end: gapEnd },
      ]);
    }

    // Repeat their gap on the far side of either one.
    const afterEnd = endOf(after, axis);
    consider(afterEnd + gap, [
      { start: gapStart, end: gapEnd },
      { start: afterEnd, end: afterEnd + gap },
    ]);
    const beforeStart = startOf(before, axis);
    consider(beforeStart - gap - size, [
      { start: beforeStart - gap, end: beforeStart },
      { start: gapStart, end: gapEnd },
    ]);
  }

  return best;
}

// ---------------------------------------------------------------------------
// Guides
// ---------------------------------------------------------------------------

/**
 * Every alignment that holds at the snapped position, not just the one that won.
 *
 * Dragging a card into a column of four already-aligned cards should light the
 * whole column, and the guide has to span all of them for that to read.
 */
function alignmentGuides(
  snapped: CanvasSnapRect,
  neighbours: readonly CanvasSnapNeighbour[],
  axis: Axis
): CanvasGuide[] {
  const cross = CROSS_AXIS[axis];
  const movingLines = linesOf(snapped, axis);
  const merged = new Map<
    string,
    { position: number; kind: CanvasGuideKind; from: number; to: number }
  >();

  for (const neighbour of neighbours) {
    const targets = linesOf(neighbour, axis);
    for (let target = 0; target < targets.length; target += 1) {
      for (let line = 0; line < movingLines.length; line += 1) {
        if (!near(targets[target], movingLines[line])) continue;
        const kind: CanvasGuideKind =
          target === 1 && line === 1 ? 'center' : 'edge';
        const key = `${kind}:${targets[target].toFixed(2)}`;
        const existing = merged.get(key);
        const from = Math.min(
          startOf(snapped, cross),
          startOf(neighbour, cross)
        );
        const to = Math.max(endOf(snapped, cross), endOf(neighbour, cross));
        if (existing) {
          existing.from = Math.min(existing.from, from);
          existing.to = Math.max(existing.to, to);
        } else {
          merged.set(key, { position: targets[target], kind, from, to });
        }
      }
    }
  }

  return [...merged.values()].map((guide) =>
    axis === 'x'
      ? {
          kind: guide.kind,
          x1: guide.position,
          y1: guide.from,
          x2: guide.position,
          y2: guide.to,
        }
      : {
          kind: guide.kind,
          x1: guide.from,
          y1: guide.position,
          x2: guide.to,
          y2: guide.position,
        }
  );
}

/** Measure bars over the two equal gaps, drawn through the card's centre. */
function spacingGuides(
  snapped: CanvasSnapRect,
  axis: Axis,
  gaps: ReadonlyArray<{ start: number; end: number }>
): CanvasGuide[] {
  const cross = CROSS_AXIS[axis];
  const at = startOf(snapped, cross) + snapped[SIZE_KEY[cross]] / 2;
  return gaps.map((gap) =>
    axis === 'x'
      ? { kind: 'spacing' as const, x1: gap.start, y1: at, x2: gap.end, y2: at }
      : { kind: 'spacing' as const, x1: at, y1: gap.start, x2: at, y2: gap.end }
  );
}
