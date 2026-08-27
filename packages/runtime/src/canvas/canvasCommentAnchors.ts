/**
 * Where a canvas comment thread is anchored.
 *
 * Two kinds, both `EntityCommentAnchor` -- no new member of the `CommentAnchor`
 * union, and no new field on it. That is a decision, not an omission:
 *
 * **Card comments** name the node: `{ entityType: 'canvas-node', entityId }`.
 * The node already exists in the board's own Y.Doc, so the anchor needs to
 * carry nothing but its id. Moving, resizing, restyling, or re-parenting the
 * card never touches it; deleting the card orphans it and the conversation
 * survives with its `labelSnapshot` still readable.
 *
 * **Pin comments** name the point: `{ entityType: 'canvas-point', entityId:
 * '<x>,<y>' }`, in board coordinates. The alternative -- a new `canvas-point`
 * anchor *kind*, or a companion pin record in the document -- was rejected on
 * two counts.
 *
 * A new kind is a change to `CommentAnchor`, which is public SDK surface shared
 * with the collab bundle, the web console, the MCP comment tools, and the
 * validator that decides which anchors a *newer* client may have written. Every
 * one of those would have to learn the kind before a pin could round-trip, and
 * an older client would treat it as `unsupported` rather than as something it
 * merely cannot draw. An entity anchor degrades far better: any client can
 * still read the thread, list it, reply to it, and say what it points at.
 *
 * A companion record is worse still, and MockupLM is the proof. Its pins live
 * in a `mockupPins` map next to the HTML, which forces a two-write creation
 * ordered pin-then-thread, a compensating rollback when the thread is refused,
 * a garbage collector for pins whose thread never landed, a grace period to
 * keep that collector from eating healthy pins during a partial sync, and a
 * hydration gate nothing has ever been able to wire. All of it exists because
 * the geometry and the thread are two objects that can disagree. Coordinates in
 * the anchor make them one object: the thread is the pin. There is nothing to
 * roll back, nothing to collect, and nothing to leak.
 *
 * The cost is that a pin cannot be dragged -- its coordinates are its identity,
 * so moving one would mean rewriting an anchor the comment protocol writes
 * once. That is the right trade for what a pin is for ("this whole cluster
 * needs work"), and re-anchoring is a feature the protocol would have to grow
 * anyway, for every editor, not a thing to pre-buy here.
 *
 * Consequence worth stating: **a pin is never orphaned.** A point in the plane
 * exists whether or not anything is drawn near it. Only card anchors can
 * orphan, and that is the case the tests are about.
 */

import type {
  CommentAnchor,
  EntityCommentAnchor,
} from '@nimbalyst/extension-sdk';

import { toCanvasCoordinate } from './CanvasDocument';

export const CANVAS_NODE_ENTITY_TYPE = 'canvas-node';
export const CANVAS_POINT_ENTITY_TYPE = 'canvas-point';

export interface CanvasPoint {
  x: number;
  y: number;
}

/** `describe` output for a thread whose card is gone but whose label was kept. */
export const CANVAS_ORPHANED_CARD_SUFFIX = ' (deleted card)';

function isEntityAnchor(
  anchor: CommentAnchor | undefined
): anchor is EntityCommentAnchor {
  return (
    anchor !== undefined &&
    anchor.kind === 'entity' &&
    typeof anchor.entityId === 'string' &&
    anchor.entityId.length > 0
  );
}

export function isCanvasNodeAnchor(
  anchor: CommentAnchor | undefined
): anchor is EntityCommentAnchor {
  return isEntityAnchor(anchor) && anchor.entityType === CANVAS_NODE_ENTITY_TYPE;
}

export function isCanvasPointAnchor(
  anchor: CommentAnchor | undefined
): anchor is EntityCommentAnchor {
  return (
    isEntityAnchor(anchor) &&
    anchor.entityType === CANVAS_POINT_ENTITY_TYPE &&
    parseCanvasPointId(anchor.entityId) !== null
  );
}

/** True for either canvas anchor kind. The codec's `handles` is this. */
export function isCanvasCommentAnchor(
  anchor: CommentAnchor | undefined
): anchor is EntityCommentAnchor {
  return isCanvasNodeAnchor(anchor) || isCanvasPointAnchor(anchor);
}

export function canvasNodeCommentAnchor(
  nodeId: string,
  labelSnapshot?: string
): EntityCommentAnchor {
  return {
    kind: 'entity',
    entityType: CANVAS_NODE_ENTITY_TYPE,
    entityId: nodeId,
    ...(labelSnapshot ? { labelSnapshot } : {}),
  };
}

export function canvasPointCommentAnchor(
  point: CanvasPoint,
  labelSnapshot?: string
): EntityCommentAnchor {
  return {
    kind: 'entity',
    entityType: CANVAS_POINT_ENTITY_TYPE,
    entityId: formatCanvasPointId(point),
    ...(labelSnapshot ? { labelSnapshot } : {}),
  };
}

/**
 * The canonical id for a point: two integers, comma-separated.
 *
 * Integers because JSON Canvas geometry is integral and a pin sits in the same
 * coordinate space as the cards; canonical because the id is the identity, so
 * two clients placing a pin at the same rounded point must produce the same
 * string.
 */
export function formatCanvasPointId(point: CanvasPoint): string {
  return `${toCanvasCoordinate(point.x)},${toCanvasCoordinate(point.y)}`;
}

export function parseCanvasPointId(entityId: string): CanvasPoint | null {
  const match = /^(-?\d+),(-?\d+)$/.exec(entityId);
  if (!match) return null;
  return { x: Number(match[1]), y: Number(match[2]) };
}

export function canvasNodeIdFromAnchor(
  anchor: CommentAnchor | undefined
): string | null {
  return isCanvasNodeAnchor(anchor) ? anchor.entityId : null;
}

export function canvasPointFromAnchor(
  anchor: CommentAnchor | undefined
): CanvasPoint | null {
  return isCanvasPointAnchor(anchor)
    ? parseCanvasPointId(anchor.entityId)
    : null;
}

/**
 * Resolve a canvas anchor against whatever knows the board's nodes.
 *
 * The same rule for the mounted adapter and the headless codec, so a thread
 * cannot be attached in one and orphaned in the other.
 */
export function canvasCommentAnchorState(
  anchor: CommentAnchor | undefined,
  hasNode: (nodeId: string) => boolean
): 'attached' | 'orphaned' {
  const nodeId = canvasNodeIdFromAnchor(anchor);
  if (nodeId !== null) return hasNode(nodeId) ? 'attached' : 'orphaned';
  // A point always resolves; an unknown anchor is not ours to call attached.
  return isCanvasPointAnchor(anchor) ? 'attached' : 'orphaned';
}

/**
 * The human-readable target, used as the thread's stored quote and as the
 * panel's anchor label.
 *
 * An orphaned card keeps its snapshot and says so, because "Card: Pricing model
 * (deleted card)" is the whole reason the label was snapshotted in the first
 * place. Falling back to the raw id would turn a lost card into an unreadable
 * thread, which is the failure this slice exists to prevent.
 *
 * `liveLabel` is tri-state and the distinction matters: `null` means the card is
 * gone, `''` means it is there and unlabelled. Collapsing the two would print
 * "(deleted card)" on a perfectly healthy sticky note that nobody titled.
 */
export function describeCanvasCommentAnchor(
  anchor: CommentAnchor | undefined,
  liveLabel: string | null
): string {
  const point = canvasPointFromAnchor(anchor);
  if (point) return `Point ${point.x}, ${point.y}`;

  const nodeId = canvasNodeIdFromAnchor(anchor);
  if (nodeId === null) return '';
  if (liveLabel !== null) return `Card: ${liveLabel || nodeId}`;

  const snapshot =
    isCanvasNodeAnchor(anchor) && anchor.labelSnapshot
      ? anchor.labelSnapshot
      : nodeId;
  return `Card: ${snapshot}${CANVAS_ORPHANED_CARD_SUFFIX}`;
}
