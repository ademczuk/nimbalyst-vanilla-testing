/**
 * Level of detail for the cards that mount a real editor.
 *
 * A document has a handful of embeds in a linear scroll and can afford to mount
 * all of them; a board has thirty in a plane and zooming out puts every one of
 * them on screen at once. So a reference card is in one of three states:
 *
 * - **cold** -- a DOM summary drawn by the canvas itself. No extension code
 *   loaded, no collab room connected.
 * - **warm** -- the real editor, mounted read-only and pointer-inert. Safe at
 *   any zoom: every rendering measurement in the NIM-3845 spike was exactly
 *   linear in k, and every failure was in pointer-to-content mapping, which an
 *   inert card cannot reach.
 * - **hot** -- the real editor, editable and focusable. Exactly one at a time,
 *   entered by clicking into the card, and only ever at scale 1.0.
 *
 * This module is the whole policy, as a pure function, for the reason
 * `canvasFlowMapping` is pure: the parts that are genuinely regression-prone
 * here are invisible on screen. "Does returning from Agent mode remount thirty
 * editors" is not a thing you can see by looking at a board.
 *
 * THE HIDDEN-SURFACE DECISION, which is the non-obvious one:
 *
 * Nimbalyst keeps every mode component mounted and toggles them with CSS
 * `display`. In Agent mode the entire editor pane is `display: none`, and inside
 * that subtree the React Flow root, every node wrapper, and every handle measure
 * 0x0. `IntersectionObserver` reports nothing intersecting -- not "unknown", but
 * a positive `isIntersecting: false` for every card.
 *
 * Taken at face value that signal says "cold everything," which would tear down
 * thirty editors and thirty rooms every time the user glances at Agent mode, and
 * rebuild them all on the way back. The opposite reading -- ignore it and keep
 * promoting -- is no better, because a hidden board would keep warming cards it
 * has no idea are on screen.
 *
 * So a hidden surface **freezes**: the previous assignment is returned verbatim,
 * no promotion and no demotion, and the surface additionally refuses to fold
 * intersection updates observed while hidden. Nothing unmounts, so returning to
 * Files mode is a no-op rather than a remount storm, and a board the user left
 * ten seconds ago is exactly as warm as they left it. The cost is that a hidden
 * board holds its rooms open; that is bounded by the warm cap and released when
 * the tab closes, and it is the cheaper of the two mistakes.
 */

export type CanvasCardLod = 'cold' | 'warm' | 'hot';

/**
 * The scale a card is activated at, and the band that counts as "already there"
 * ([NIM-3845](nimbalyst://NIM-3845)).
 *
 * Activation policy lives beside the LOD policy because `hot` is an LOD state:
 * "which card is the real editor" and "may it be at this zoom" are one decision.
 */
export const CANVAS_ACTIVATION_ZOOM = 1;
export const CANVAS_ACTIVATION_ZOOM_TOLERANCE = 0.02;

/** True when the viewport is close enough to 1.0 to activate without animating. */
export function isCanvasActivationZoom(zoom: number): boolean {
  return (
    Math.abs(zoom - CANVAS_ACTIVATION_ZOOM) <= CANVAS_ACTIVATION_ZOOM_TOLERANCE
  );
}

export interface CanvasLodPolicy {
  /**
   * How many cards may hold a mounted editor at once, hot included.
   *
   * Twelve is measured, not guessed: see the heavy-board numbers in the Slice 3
   * notes. It is a cap on *third-party React*, so it has to be set for the worst
   * extension on the board rather than the average one.
   */
  mountCap: number;
  /** At or above this scale, warm cards may mount. */
  warmAboveZoom: number;
  /**
   * Below this scale, everything cold. Separate from `warmAboveZoom` on purpose:
   * a single threshold makes a user resting the viewport near it mount and
   * unmount the whole board on every wheel tick. Between the two, the board
   * keeps whatever regime it was already in.
   */
  coldBelowZoom: number;
}

export const CANVAS_LOD_POLICY: CanvasLodPolicy = {
  mountCap: 12,
  warmAboveZoom: 0.45,
  coldBelowZoom: 0.35,
};

/**
 * The viewport scale, quantised to the buckets anything downstream can tell
 * apart: the activation band, warm, the hysteresis band, and cold.
 *
 * A wheel-zoom produces a transform per animation frame. Subscribing thirty
 * cards to the raw scale would re-render all of them on every one of those
 * frames to compute answers that do not change. Every returned value sits inside
 * the bucket it represents, so a consumer that treats it as the real zoom gets
 * the same answer it would have got from the real zoom.
 */
export function canvasZoomBucket(
  zoom: number,
  policy: CanvasLodPolicy = CANVAS_LOD_POLICY
): number {
  if (isCanvasActivationZoom(zoom)) return CANVAS_ACTIVATION_ZOOM;
  if (zoom >= policy.warmAboveZoom) return policy.warmAboveZoom;
  if (zoom < policy.coldBelowZoom) return 0;
  return (policy.warmAboveZoom + policy.coldBelowZoom) / 2;
}

export interface CanvasLodInput {
  /** Cards that could mount an editor -- reference cards -- in board order. */
  candidateIds: readonly string[];
  /** Cards currently intersecting the surface viewport. */
  visibleIds: ReadonlySet<string>;
  /** Viewport scale. */
  zoom: number;
  /**
   * The activated card, or null. Already gated on the activation band by the
   * caller, so a non-null value here means the viewport is at 1.0.
   */
  hotId: string | null;
  /** True when the surface sits in a `display: none` subtree. */
  surfaceHidden: boolean;
  /**
   * True while a pan or zoom gesture is in flight.
   *
   * Freezes for a different reason than `surfaceHidden` but by the same
   * mechanism. Measured on a board of thirty RevoGrids: a fast pan that swaps ten
   * cards in and out costs p95 62.7 ms and a 120.9 ms worst frame, seven of
   * seventy-nine frames over budget -- while the same gesture with every card
   * cold, and the same twelve cards mounted but not churning, both run flat at
   * 16.7 ms. The cost is entirely mount and unmount, so the fix is to do neither
   * until the user stops moving. Nothing is lost: the frame in which a card
   * would have been promoted is a frame the user is dragging past it.
   */
  gestureActive: boolean;
  /** The previous assignment. Returned verbatim when nothing changes. */
  previous: ReadonlyMap<string, CanvasCardLod>;
  /** Most-recently-wanted card first; breaks ties for the last mount slots. */
  recency: readonly string[];
  policy?: CanvasLodPolicy;
}

/**
 * The per-card assignment.
 *
 * Returns `input.previous` itself whenever the result is equal to it, so a
 * caller can drop the update into `setState` and get React's bail-out for free
 * rather than re-rendering every card on every intersection callback.
 */
export function computeCanvasCardLod(
  input: CanvasLodInput
): ReadonlyMap<string, CanvasCardLod> {
  const { candidateIds, previous } = input;

  if (input.surfaceHidden || input.gestureActive) {
    // Frozen. Candidates can still disappear (a card was deleted), and holding
    // an entry for a node that no longer exists would leak it across the next
    // promotion, so the map is still restricted to the current candidates.
    return stabilize(
      previous,
      new Map(
        candidateIds.map((id) => [id, previous.get(id) ?? 'cold'] as const)
      )
    );
  }

  const policy = input.policy ?? CANVAS_LOD_POLICY;
  const candidates = new Set(candidateIds);
  const next = new Map<string, CanvasCardLod>();

  const hotId =
    input.hotId !== null && candidates.has(input.hotId) ? input.hotId : null;

  let budget = mountBudget(input, policy);
  if (hotId !== null) {
    next.set(hotId, 'hot');
    budget -= 1;
  }

  const recencyRank = new Map(input.recency.map((id, index) => [id, index]));
  const boardRank = new Map(candidateIds.map((id, index) => [id, index]));

  const warmable = candidateIds
    .filter((id) => id !== hotId && input.visibleIds.has(id))
    .sort((left, right) => {
      // Already mounted wins, so a card does not lose its editor to a card that
      // just scrolled in -- unmounting is the expensive direction.
      const mounted =
        Number(
          previous.get(right) !== undefined && previous.get(right) !== 'cold'
        ) -
        Number(
          previous.get(left) !== undefined && previous.get(left) !== 'cold'
        );
      if (mounted !== 0) return mounted;
      const recency =
        (recencyRank.get(left) ?? Number.MAX_SAFE_INTEGER) -
        (recencyRank.get(right) ?? Number.MAX_SAFE_INTEGER);
      if (recency !== 0) return recency;
      return (boardRank.get(left) ?? 0) - (boardRank.get(right) ?? 0);
    });

  for (const id of warmable) {
    next.set(id, budget > 0 ? 'warm' : 'cold');
    if (budget > 0) budget -= 1;
  }
  for (const id of candidateIds) {
    if (!next.has(id)) next.set(id, 'cold');
  }

  return stabilize(previous, next);
}

/**
 * How many editors may be mounted, given the zoom regime.
 *
 * Zero below the cold threshold: at k = 0.35 a 13 px label paints at 4.5 px, so
 * a mounted editor is costing third-party React for something nobody can read.
 */
function mountBudget(input: CanvasLodInput, policy: CanvasLodPolicy): number {
  if (input.zoom >= policy.warmAboveZoom) return policy.mountCap;
  if (input.zoom < policy.coldBelowZoom) return 0;
  // In the hysteresis band, keep whatever regime the board is already in.
  const wasWarm = [...input.previous.values()].some((lod) => lod !== 'cold');
  return wasWarm ? policy.mountCap : 0;
}

function stabilize(
  previous: ReadonlyMap<string, CanvasCardLod>,
  next: ReadonlyMap<string, CanvasCardLod>
): ReadonlyMap<string, CanvasCardLod> {
  if (previous.size !== next.size) return next;
  for (const [id, lod] of next) {
    if (previous.get(id) !== lod) return next;
  }
  return previous;
}

/**
 * Fold a newly-wanted card to the front of the recency list.
 *
 * Kept here rather than in the surface because it is half of the cap policy: the
 * cap decides how many cards may mount and this decides which ones lose when the
 * board has more visible cards than slots.
 */
export function touchCanvasRecency(
  recency: readonly string[],
  wanted: Iterable<string>
): readonly string[] {
  const promoted = [...wanted];
  if (promoted.length === 0) return recency;
  const rest = recency.filter((id) => !promoted.includes(id));
  if (rest.length === recency.length && promoted.length === 0) return recency;
  const next = [...promoted, ...rest];
  return next.length === recency.length &&
    next.every((id, i) => id === recency[i])
    ? recency
    : next;
}
