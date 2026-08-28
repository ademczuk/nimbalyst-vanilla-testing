/**
 * Canvas document <-> React Flow mapping.
 *
 * Pure: no React, no DOM, and `@xyflow/react` enters only as erased types. The
 * surface is a thin shell over this module on purpose -- the parts of a canvas
 * that are genuinely regression-prone are invisible on screen (z-order derived
 * from rank, the integer geometry boundary, and turning React Flow's change
 * stream back into document edits), so they live here where a node-environment
 * test can reach them without mounting anything.
 *
 * Every function returns the *same* document object when a change is a no-op,
 * and preserves the identity of untouched nodes. Callers rely on that: it is
 * what keeps a drag from marking every other card dirty, and what lets React
 * skip re-rendering cards nobody moved.
 */
import type {
  Connection,
  Edge,
  EdgeChange,
  Node,
  NodeChange,
} from '@xyflow/react';

import { isCanvasActivationZoom, type CanvasCardLod } from './canvasCardLod';
import type { CanvasCardReference } from './canvasCallbacks';
import {
  NIMBALYST_CANVAS_NAMESPACE,
  type CanvasAnyNode,
  type CanvasDocument,
  type CanvasEdge,
  type CanvasNodeReference,
  type CanvasSide,
  type CanvasViewport,
  toCanvasCoordinate,
  withCanvasGeometryRounded,
} from './CanvasDocument';
import {
  CANVAS_NODE_RANK_FIELD,
  canvasRankBetween,
  compareCanvasRank,
  normalizeCanvasRank,
} from './canvasRank';

/** The single React Flow node type; the card component dispatches on `kind`. */
export const CANVAS_FLOW_NODE_TYPE = 'canvasCard';
/** The single React Flow edge type. */
export const CANVAS_FLOW_EDGE_TYPE = 'canvasEdge';

/**
 * What a card actually draws.
 *
 * `reference` and `unsupported` are the honest-placeholder kinds and must stay:
 * a `file` / `doc` card is a real reference this slice cannot mount yet, and an
 * `unsupported` node is a foreign `type` the format promises to preserve. Both
 * render as a labelled placeholder -- never dropped, never blank.
 */
export type CanvasCardKind =
  | 'sticky'
  | 'text'
  | 'image'
  | 'group'
  | 'link'
  | 'reference'
  | 'unsupported';

export interface CanvasCardData extends Record<string, unknown> {
  node: CanvasAnyNode;
  kind: CanvasCardKind;
  /** True for the one card the user has activated (see the activation model). */
  active: boolean;
  /**
   * How much of this card is realised. Reference cards get their state from the
   * LOD map; everything else is native DOM the canvas draws itself and is always
   * fully realised, so it is `warm` until activated.
   */
  lod: CanvasCardLod;
  readOnly: boolean;
}

export interface CanvasEdgeData extends Record<string, unknown> {
  edge: CanvasEdge;
}

export type CanvasFlowNode = Node<CanvasCardData, typeof CANVAS_FLOW_NODE_TYPE>;
export type CanvasFlowEdge = Edge<CanvasEdgeData, typeof CANVAS_FLOW_EDGE_TYPE>;

export interface CanvasFlowOptions {
  /** The activated card, if any. Pointer-inert cards are the default. */
  activeNodeId?: string | null;
  /**
   * Viewport scale. Omit when no viewport is driving the mapping (a headless
   * export, a test); supplying it turns on the activation gate below.
   */
  zoom?: number;
  /** Per-card LOD for reference cards. Absent entries are cold. */
  lod?: ReadonlyMap<string, CanvasCardLod>;
  /**
   * Selection is view state held by the surface, not by the document. A `.canvas`
   * file reviews as a git diff, and "who had what selected" has no business in
   * one; it also must not survive a reload or travel to a collaborator.
   */
  selectedIds?: ReadonlySet<string>;
  readOnly?: boolean;
}

/** Fold React Flow's `select` changes into the surface's selection set. */
export function applyCanvasSelection(
  selected: ReadonlySet<string>,
  changes: ReadonlyArray<{ type: string; id?: string; selected?: boolean }>
): ReadonlySet<string> {
  let next: Set<string> | null = null;
  for (const change of changes) {
    const id = change.id;
    if (id === undefined) continue;
    const shouldSelect = change.type === 'select' && change.selected === true;
    if (change.type !== 'select' && change.type !== 'remove') continue;
    if (shouldSelect === (next ?? selected).has(id)) continue;
    next ??= new Set(selected);
    if (shouldSelect) next.add(id);
    else next.delete(id);
  }
  return next ?? selected;
}

/** Default geometry for a newly created card, per kind. */
const NEW_CARD_SIZE: Record<string, { width: number; height: number }> = {
  sticky: { width: 240, height: 180 },
  text: { width: 320, height: 200 },
  image: { width: 360, height: 260 },
  group: { width: 640, height: 440 },
};

// ---------------------------------------------------------------------------
// Reading a card out of a node
// ---------------------------------------------------------------------------

export function canvasNodeReference(
  node: CanvasAnyNode
): CanvasNodeReference | undefined {
  return node[NIMBALYST_CANVAS_NAMESPACE]?.reference;
}

/**
 * Which card a node draws as.
 *
 * The `x-nimbalyst` reference wins when present, so a Nimbalyst-authored sticky
 * note is a sticky note. A node with no reference falls back to its JSON Canvas
 * `type`, which is what makes a board written by another tool render as
 * something meaningful rather than a wall of placeholders.
 */
export function canvasCardKind(node: CanvasAnyNode): CanvasCardKind {
  const reference = canvasNodeReference(node);
  if (reference?.kind === 'file' || reference?.kind === 'doc')
    return 'reference';
  if (reference?.kind === 'native') {
    switch (reference.nativeKind) {
      case 'sticky':
      case 'text':
      case 'image':
      case 'group':
        // `CanvasNativeKind` is deliberately open-ended, so the literal cases
        // do not narrow it on their own.
        return reference.nativeKind as CanvasCardKind;
      default:
        return 'unsupported';
    }
  }

  switch (node.type) {
    case 'text':
      return 'text';
    case 'group':
      return 'group';
    case 'link':
      return 'link';
    case 'file':
      return 'reference';
    default:
      return 'unsupported';
  }
}

export function canvasCardText(node: CanvasAnyNode): string {
  return typeof node.text === 'string' ? node.text : '';
}

export function canvasCardUrl(node: CanvasAnyNode): string {
  return typeof node.url === 'string' ? node.url : '';
}

/** The `x-nimbalyst` label, the spec `label`, or nothing. */
export function canvasCardLabel(node: CanvasAnyNode): string {
  const extensionLabel = node[NIMBALYST_CANVAS_NAMESPACE]?.label;
  if (typeof extensionLabel === 'string' && extensionLabel)
    return extensionLabel;
  return typeof node.label === 'string' ? node.label : '';
}

/** The workspace path or document URI a `reference` card points at. */
export function canvasCardTarget(node: CanvasAnyNode): string {
  const reference = canvasNodeReference(node);
  if (reference?.kind === 'file') return reference.path;
  if (reference?.kind === 'doc') return reference.uri;
  if (typeof node.file === 'string') return node.file;
  return canvasCardUrl(node);
}

function canvasNodeRank(node: CanvasAnyNode): string | null {
  return normalizeCanvasRank(node[CANVAS_NODE_RANK_FIELD]);
}

// ---------------------------------------------------------------------------
// Document -> React Flow
// ---------------------------------------------------------------------------

/**
 * Nodes in painting order: bottom first, top last.
 *
 * JSON Canvas stores z-order as array position, and the collaborative document
 * carries it as a rank string on the node instead (see `CANVAS_NODE_RANK_FIELD`
 * for why). Sorting by rank covers both: a file-loaded document has no ranks at
 * all, every comparison is a tie, and `Array#sort`'s stability leaves the file's
 * array order exactly as the spec intends.
 */
export function orderCanvasNodes(
  nodes: readonly CanvasAnyNode[]
): CanvasAnyNode[] {
  return [...nodes].sort((left, right) =>
    compareCanvasRank(canvasNodeRank(left), canvasNodeRank(right))
  );
}

/**
 * React Flow nodes with a rank-derived `zIndex`.
 *
 * The index in painting order *is* the z-index. Rank strings are ordering keys
 * with no numeric meaning, so their position in the sorted array is the only
 * thing that may reach a renderer. Requires `zIndexMode="manual"` on the flow;
 * see the note in CanvasSurface.
 */
export function toFlowNodes(
  document: CanvasDocument,
  options: CanvasFlowOptions = {}
): CanvasFlowNode[] {
  const readOnly = options.readOnly === true;
  /*
   * The activation gate, and the one invariant NIM-3845 leaves behind: a hot
   * card may never sit under a scale transform.
   *
   * Popover and Monaco maths measured correct at every scale, so this is not
   * about positioning. It is about RevoGrid-class hit-testing, whose error is
   * `d_local * (k - 1)` with no scale floor to sit above -- and about any future
   * card that hit-tests the same way. Activation animates to 1.0, so the card is
   * fine at the moment it goes hot; the hazard is everything that changes the
   * zoom afterwards -- the Controls buttons, ctrl+wheel, the minimap, `fitView`.
   * The gate lives here, at the single function that decides which card is hot,
   * rather than in a handler one of those paths could forget to call.
   */
  const activationAllowed =
    options.zoom === undefined || isCanvasActivationZoom(options.zoom);
  return orderCanvasNodes(document.nodes ?? []).map((node, index) => {
    const kind = canvasCardKind(node);
    const active = activationAllowed && options.activeNodeId === node.id;
    const lod: CanvasCardLod = active
      ? 'hot'
      : kind === 'reference'
      ? options.lod?.get(node.id) ?? 'cold'
      : 'warm';
    return {
      id: node.id,
      type: CANVAS_FLOW_NODE_TYPE,
      position: { x: node.x, y: node.y },
      width: node.width,
      height: node.height,
      zIndex: index,
      selected: options.selectedIds?.has(node.id) === true,
      // An activated card owns the pointer: dragging it by its own body would
      // fight text selection inside it, so the drag handle goes away until the
      // user presses Escape.
      draggable: !readOnly && !active,
      selectable: !active,
      connectable: !readOnly && !active,
      deletable: !readOnly,
      data: { node, kind, active, lod, readOnly },
    };
  });
}

/**
 * The `file` / `doc` reference a card mounts, or null for a native card.
 *
 * A plain-spec `type: "file"` node written by another tool carries no
 * `x-nimbalyst` block at all, and it is still a real reference to a real file --
 * synthesising one here is what lets an Obsidian-authored board mount live
 * editors rather than showing placeholders.
 */
export function canvasCardReference(
  node: CanvasAnyNode
): CanvasCardReference | null {
  const reference = canvasNodeReference(node);
  if (reference?.kind === 'file' || reference?.kind === 'doc') {
    return reference;
  }
  if (node.type === 'file' && typeof node.file === 'string' && node.file) {
    return { kind: 'file', path: node.file };
  }
  return null;
}

/** Ids of the cards that could mount an editor, in board order. */
export function canvasReferenceNodeIds(document: CanvasDocument): string[] {
  return (document.nodes ?? [])
    .filter((node) => canvasCardReference(node) !== null)
    .map((node) => node.id);
}

export function toFlowEdges(
  document: CanvasDocument,
  options: CanvasFlowOptions = {}
): CanvasFlowEdge[] {
  const readOnly = options.readOnly === true;
  const byId = new Map((document.nodes ?? []).map((node) => [node.id, node]));
  return (document.edges ?? []).map((edge) => {
    const sides = edgeSides(
      edge,
      byId.get(edge.fromNode),
      byId.get(edge.toNode)
    );
    return {
      id: edge.id,
      type: CANVAS_FLOW_EDGE_TYPE,
      source: edge.fromNode,
      target: edge.toNode,
      sourceHandle: sourceHandleId(sides.from),
      targetHandle: targetHandleId(sides.to),
      selected: options.selectedIds?.has(edge.id) === true,
      deletable: !readOnly,
      data: { edge },
    };
  });
}

export function sourceHandleId(side: CanvasSide): string {
  return `source-${side}`;
}

export function targetHandleId(side: CanvasSide): string {
  return `target-${side}`;
}

/** `source-right` -> `right`, or null for a handle id we did not mint. */
export function sideFromHandleId(
  handleId: string | null | undefined
): CanvasSide | null {
  const side = handleId?.split('-')[1];
  return side === 'top' ||
    side === 'right' ||
    side === 'bottom' ||
    side === 'left'
    ? side
    : null;
}

/**
 * JSON Canvas makes `fromSide` / `toSide` optional and leaves the choice to the
 * app. Rather than always attaching right-to-left, pick the axis the two cards
 * actually sit on, which keeps an imported board's arrows from crossing their
 * own cards. The choice is presentational and is never written to the file.
 */
function edgeSides(
  edge: CanvasEdge,
  from: CanvasAnyNode | undefined,
  to: CanvasAnyNode | undefined
): { from: CanvasSide; to: CanvasSide } {
  if (edge.fromSide && edge.toSide)
    return { from: edge.fromSide, to: edge.toSide };

  let derivedFrom: CanvasSide = 'right';
  let derivedTo: CanvasSide = 'left';
  if (from && to) {
    const dx = to.x + to.width / 2 - (from.x + from.width / 2);
    const dy = to.y + to.height / 2 - (from.y + from.height / 2);
    if (Math.abs(dy) > Math.abs(dx)) {
      derivedFrom = dy >= 0 ? 'bottom' : 'top';
      derivedTo = dy >= 0 ? 'top' : 'bottom';
    } else {
      derivedFrom = dx >= 0 ? 'right' : 'left';
      derivedTo = dx >= 0 ? 'left' : 'right';
    }
  }
  return { from: edge.fromSide ?? derivedFrom, to: edge.toSide ?? derivedTo };
}

// ---------------------------------------------------------------------------
// React Flow -> document
// ---------------------------------------------------------------------------

/** A node's box, and the only thing a drag or a resize is allowed to change. */
export interface CanvasNodeGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const EMPTY_CANVAS_GEOMETRY: ReadonlyMap<string, CanvasNodeGeometry> =
  new Map();

/**
 * What a batch of React Flow changes means for durability.
 *
 * `transient` is a frame in the middle of a gesture: the pointer is still down,
 * the number is going to be replaced by the next frame, and writing it to the
 * document would cost a Y.Doc transaction, an outbox row, and a renderer-to-main
 * IPC round trip for a position nobody will ever read. It is presence, and it
 * goes out as presence. `boundary` is the frame that ends the gesture and is the
 * one durable write. `discrete` is everything else -- a delete, an explicit
 * resize commit, a change with no gesture behind it -- and writes immediately.
 *
 * A batch that ends a gesture is a boundary even though it also carries a
 * position: React Flow re-emits the final position with `dragging: false`, and
 * that frame is the one the board has to keep.
 */
export function canvasGestureKind(
  changes: readonly NodeChange[]
): 'transient' | 'boundary' | 'discrete' {
  let transient = false;
  for (const change of changes) {
    if (change.type === 'position') {
      if (change.dragging === false) return 'boundary';
      if (change.dragging === true) transient = true;
    } else if (change.type === 'dimensions') {
      if (change.resizing === false) return 'boundary';
      if (change.resizing === true) transient = true;
    }
  }
  return transient ? 'transient' : 'discrete';
}

export interface CanvasGestureStep {
  kind: 'transient' | 'boundary' | 'discrete';
  /** The one document to write, or null when nothing durable happened. */
  commit: CanvasDocument | null;
  /**
   * Geometry to paint and publish as presence, held out of the document.
   * Returned by identity when it did not change, so a caller can compare.
   */
  held: ReadonlyMap<string, CanvasNodeGeometry>;
}

/**
 * One batch of React Flow changes, decided.
 *
 * All of the judgement in the drag path is here rather than in the surface's
 * event handler, because every one of these branches is a bug that is invisible
 * on screen: a frame that writes when it should be held costs an outbox row and
 * an IPC call each; a frame that is held when it should be written loses the
 * user's move; and a batch folded against the wrong base commits a position the
 * pointer never settled on.
 *
 * A gesture folds against `held` -- the document with its own frames already
 * painted on -- so snapping, a frame carrying its contents, and the running box
 * behave exactly as they did when every frame was a document edit. Everything
 * else folds against the document, which is what keeps React Flow's constant
 * re-measurement from committing a card mid-drag.
 *
 * `commit` is compared against the *document*, never against the base: a
 * gesture's closing frame usually repeats the position `held` already carries,
 * so a diff from the base would be empty while the document has seen none of it.
 */
export function stepCanvasGesture(
  document: CanvasDocument,
  held: ReadonlyMap<string, CanvasNodeGeometry>,
  changes: readonly NodeChange[],
  snap?: (
    changes: readonly NodeChange[],
    base: CanvasDocument
  ) => readonly NodeChange[]
): CanvasGestureStep {
  const kind = canvasGestureKind(changes);
  const base =
    kind === 'discrete' ? document : withCanvasNodeGeometry(document, held);
  const next = applyCanvasNodeChanges(base, snap ? snap(changes, base) : changes);

  if (kind === 'transient') {
    return {
      kind,
      commit: null,
      held: next === base ? held : canvasGeometryOverlay(document, next),
    };
  }
  return {
    kind,
    commit: next === document ? null : next,
    held: kind === 'boundary' ? EMPTY_CANVAS_GEOMETRY : held,
  };
}

/**
 * Which nodes `next` moved or resized, relative to `document`.
 *
 * Geometry only. The point of holding a gesture out of the document is that the
 * document keeps arriving from teammates underneath it, so the thing carried
 * across frames has to be the narrow fact the pointer is producing rather than a
 * whole board that would revert their edits when it lands.
 */
export function canvasGeometryOverlay(
  document: CanvasDocument,
  next: CanvasDocument
): ReadonlyMap<string, CanvasNodeGeometry> {
  const before = new Map(
    (document.nodes ?? []).map((node) => [node.id, node] as const)
  );
  const overlay = new Map<string, CanvasNodeGeometry>();
  for (const node of next.nodes ?? []) {
    const original = before.get(node.id);
    if (
      original === undefined ||
      (original.x === node.x &&
        original.y === node.y &&
        original.width === node.width &&
        original.height === node.height)
    ) {
      continue;
    }
    overlay.set(node.id, {
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
    });
  }
  return overlay.size === 0 ? EMPTY_CANVAS_GEOMETRY : overlay;
}

/**
 * Paint `overlay` over `document`, leaving every other field and every
 * untouched node's identity alone.
 */
export function withCanvasNodeGeometry(
  document: CanvasDocument,
  overlay: ReadonlyMap<string, CanvasNodeGeometry>
): CanvasDocument {
  if (overlay.size === 0) return document;
  const nodes = document.nodes ?? [];
  let changed = false;
  const next = nodes.map((node) => {
    const geometry = overlay.get(node.id);
    if (
      geometry === undefined ||
      (node.x === geometry.x &&
        node.y === geometry.y &&
        node.width === geometry.width &&
        node.height === geometry.height)
    ) {
      return node;
    }
    changed = true;
    return { ...node, ...geometry };
  });
  return changed ? { ...document, nodes: next } : document;
}

/**
 * Fold React Flow's node changes back into the document.
 *
 * Selection is deliberately not handled: it is view state and has no business
 * in a file that reviews as a git diff. Measurement-only `dimensions` changes
 * are ignored too -- React Flow reports the DOM's measured box after every
 * render, and honouring that would let a rounding difference mark a board dirty
 * with no user edit behind it. Only an explicit resize (`setAttributes`) counts.
 */
export function applyCanvasNodeChanges(
  document: CanvasDocument,
  changes: readonly NodeChange[]
): CanvasDocument {
  const nodes = document.nodes ?? [];
  if (nodes.length === 0) return document;

  const movedIds = new Set(
    changes
      .filter(
        (change): change is Extract<NodeChange, { type: 'position' }> =>
          change.type === 'position' && change.position !== undefined
      )
      .map((change) => change.id)
  );

  let next: CanvasAnyNode[] = nodes;
  let changed = false;
  const removed = new Set<string>();

  const replace = (
    id: string,
    update: (node: CanvasAnyNode) => CanvasAnyNode
  ): void => {
    const index = next.findIndex((node) => node.id === id);
    if (index < 0) return;
    const updated = update(next[index]);
    if (updated === next[index]) return;
    if (!changed) next = [...next];
    next[index] = updated;
    changed = true;
  };

  for (const change of changes) {
    switch (change.type) {
      case 'position': {
        if (!change.position) break;
        const current = next.find((node) => node.id === change.id);
        if (!current) break;
        const x = toCanvasCoordinate(change.position.x);
        const y = toCanvasCoordinate(change.position.y);
        if (x === current.x && y === current.y) break;
        const dx = x - current.x;
        const dy = y - current.y;
        // A frame carries whatever it encloses. Cards the user is dragging
        // themselves in the same batch are skipped so a group-plus-child
        // selection cannot move a child twice.
        if (canvasCardKind(current) === 'group') {
          for (const contained of containedNodeIds(next, current)) {
            if (movedIds.has(contained)) continue;
            replace(contained, (node) => translateNode(node, dx, dy));
          }
        }
        replace(change.id, (node) => ({ ...node, x, y }));
        break;
      }
      case 'dimensions': {
        if (!change.dimensions) break;
        if (change.resizing !== true && !change.setAttributes) break;
        const width = toCanvasCoordinate(change.dimensions.width);
        const height = toCanvasCoordinate(change.dimensions.height);
        replace(change.id, (node) =>
          node.width === width && node.height === height
            ? node
            : { ...node, width, height }
        );
        break;
      }
      case 'remove': {
        removed.add(change.id);
        break;
      }
      default:
        // 'select' is view state; 'add' / 'replace' never originate from React
        // Flow for a fully controlled flow like this one.
        break;
    }
  }

  if (removed.size > 0) {
    const remaining = next.filter((node) => !removed.has(node.id));
    if (remaining.length !== next.length) {
      next = remaining;
      changed = true;
    }
  }

  if (!changed) return document;
  const result: CanvasDocument = { ...document, nodes: next };
  return removed.size > 0 ? withEdgesPruned(result, removed) : result;
}

export function applyCanvasEdgeChanges(
  document: CanvasDocument,
  changes: readonly EdgeChange[]
): CanvasDocument {
  const removed = new Set(
    changes
      .filter((change) => change.type === 'remove')
      .map((change) => change.id)
  );
  if (removed.size === 0) return document;
  const edges = (document.edges ?? []).filter((edge) => !removed.has(edge.id));
  if (edges.length === (document.edges ?? []).length) return document;
  return { ...document, edges };
}

/** Add the edge React Flow's drag-to-connect just produced. */
export function connectCanvasEdge(
  document: CanvasDocument,
  connection: Connection
): CanvasDocument {
  if (!connection.source || !connection.target) return document;
  const edges = document.edges ?? [];
  const fromSide = sideFromHandleId(connection.sourceHandle);
  const toSide = sideFromHandleId(connection.targetHandle);
  const duplicate = edges.some(
    (edge) =>
      edge.fromNode === connection.source &&
      edge.toNode === connection.target &&
      edge.fromSide === (fromSide ?? undefined) &&
      edge.toSide === (toSide ?? undefined)
  );
  if (duplicate) return document;

  const edge: CanvasEdge = {
    id: createCanvasId('edge', new Set(edges.map((entry) => entry.id))),
    fromNode: connection.source,
    toNode: connection.target,
    ...(fromSide ? { fromSide } : {}),
    ...(toSide ? { toSide } : {}),
    toEnd: 'arrow',
  };
  return { ...document, edges: [...edges, edge] };
}

function withEdgesPruned(
  document: CanvasDocument,
  removedNodeIds: ReadonlySet<string>
): CanvasDocument {
  const edges = document.edges ?? [];
  const kept = edges.filter(
    (edge) =>
      !removedNodeIds.has(edge.fromNode) && !removedNodeIds.has(edge.toNode)
  );
  return kept.length === edges.length ? document : { ...document, edges: kept };
}

function translateNode(
  node: CanvasAnyNode,
  dx: number,
  dy: number
): CanvasAnyNode {
  if (dx === 0 && dy === 0) return node;
  return { ...node, x: node.x + dx, y: node.y + dy };
}

/** Ids of the nodes wholly inside `group`'s current bounds, excluding itself. */
function containedNodeIds(
  nodes: readonly CanvasAnyNode[],
  group: CanvasAnyNode
): string[] {
  const right = group.x + group.width;
  const bottom = group.y + group.height;
  return nodes
    .filter(
      (node) =>
        node.id !== group.id &&
        node.x >= group.x &&
        node.y >= group.y &&
        node.x + node.width <= right &&
        node.y + node.height <= bottom
    )
    .map((node) => node.id);
}

// ---------------------------------------------------------------------------
// Document edits the surface makes directly
// ---------------------------------------------------------------------------

/** Patch spec fields on one node, leaving every other node's identity intact. */
export function updateCanvasNode(
  document: CanvasDocument,
  id: string,
  patch: Record<string, unknown>
): CanvasDocument {
  const nodes = document.nodes ?? [];
  const index = nodes.findIndex((node) => node.id === id);
  if (index < 0) return document;
  const current = nodes[index];
  if (Object.entries(patch).every(([key, value]) => current[key] === value)) {
    return document;
  }
  const next = [...nodes];
  next[index] = withCanvasGeometryRounded({
    ...current,
    ...patch,
  } as CanvasAnyNode);
  return { ...document, nodes: next };
}

/**
 * Move a node to the top or the bottom of the stack.
 *
 * Array position is the on-disk z-order, so the array move is the real edit.
 * When the document also carries ranks -- it will once the collaborative
 * binding lands -- the rank has to move with it, or the two representations
 * disagree and the board repaints in a different order than it saves.
 */
export function reorderCanvasNode(
  document: CanvasDocument,
  id: string,
  placement: 'front' | 'back'
): CanvasDocument {
  const ordered = orderCanvasNodes(document.nodes ?? []);
  const index = ordered.findIndex((node) => node.id === id);
  if (index < 0) return document;
  if (placement === 'front' && index === ordered.length - 1) return document;
  if (placement === 'back' && index === 0) return document;

  const ranked = ordered.some((node) => canvasNodeRank(node) !== null);
  const [moved] = ordered.splice(index, 1);
  const placedAtFront = placement === 'front';
  const neighbour = placedAtFront
    ? canvasNodeRank(ordered[ordered.length - 1] ?? moved)
    : canvasNodeRank(ordered[0] ?? moved);

  const next = ranked
    ? {
        ...moved,
        [CANVAS_NODE_RANK_FIELD]: placedAtFront
          ? canvasRankBetween(neighbour, null)
          : canvasRankBetween(null, neighbour),
      }
    : moved;

  ordered.splice(placedAtFront ? ordered.length : 0, 0, next);
  return { ...document, nodes: ordered };
}

export function addCanvasNode(
  document: CanvasDocument,
  node: CanvasAnyNode
): CanvasDocument {
  return { ...document, nodes: [...(document.nodes ?? []), node] };
}

/**
 * A new native card of `kind`, centred on `center` in canvas coordinates.
 *
 * The spec `type` is chosen so a plain JSON Canvas reader still shows something
 * true: a sticky note and a text card are both `text` nodes, an image is a
 * `link` node carrying its URL, and a frame is a `group`.
 */
export function createNativeCanvasNode(
  document: CanvasDocument,
  kind: 'sticky' | 'text' | 'image' | 'group',
  center: { x: number; y: number }
): CanvasAnyNode {
  const size = NEW_CARD_SIZE[kind];
  const existing = new Set((document.nodes ?? []).map((node) => node.id));
  const base = {
    id: createCanvasId(kind, existing),
    x: toCanvasCoordinate(center.x - size.width / 2),
    y: toCanvasCoordinate(center.y - size.height / 2),
    width: size.width,
    height: size.height,
    [NIMBALYST_CANVAS_NAMESPACE]: {
      reference: { kind: 'native' as const, nativeKind: kind },
    },
  };

  switch (kind) {
    case 'sticky':
      return { ...base, type: 'text', text: '', color: '5' } as CanvasAnyNode;
    case 'text':
      return { ...base, type: 'text', text: '' } as CanvasAnyNode;
    case 'image':
      return { ...base, type: 'link', url: '' } as CanvasAnyNode;
    case 'group':
      return { ...base, type: 'group', label: 'Frame' } as CanvasAnyNode;
  }
}

/**
 * A new card pointing at an existing `file` or `doc`, centred on `center`.
 *
 * The spec `type` is chosen so a plain JSON Canvas reader still shows something
 * true: a workspace file is a `file` node carrying its path, and a shared
 * document -- which the spec has no concept of -- is a `link` node carrying its
 * `nimbalyst://doc/...` URI. Both also carry the `x-nimbalyst` reference, which
 * is what `canvasCardKind` actually reads; the spec fields are for the other
 * tool's benefit, not ours.
 *
 * Sized like a frame rather than like a sticky note. A reference card mounts a
 * real editor, and the default has to be large enough that the thing inside it
 * is legible without a resize first.
 */
export function createReferenceCanvasNode(
  document: CanvasDocument,
  reference: CanvasCardReference,
  center: { x: number; y: number },
  label?: string
): CanvasAnyNode {
  const size = NEW_CARD_SIZE.group;
  const existing = new Set((document.nodes ?? []).map((node) => node.id));
  const base = {
    id: createCanvasId(reference.kind, existing),
    x: toCanvasCoordinate(center.x - size.width / 2),
    y: toCanvasCoordinate(center.y - size.height / 2),
    width: size.width,
    height: size.height,
    [NIMBALYST_CANVAS_NAMESPACE]: {
      reference,
      ...(label ? { label } : {}),
    },
  };
  return reference.kind === 'file'
    ? ({ ...base, type: 'file', file: reference.path } as CanvasAnyNode)
    : ({ ...base, type: 'link', url: reference.uri } as CanvasAnyNode);
}

export function createCanvasId(
  prefix: string,
  existing: ReadonlySet<string>
): string {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const id = `${prefix}-${randomSuffix()}`;
    if (!existing.has(id)) return id;
  }
  throw new Error('Could not mint a unique canvas id');
}

function randomSuffix(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid.replace(/-/g, '').slice(0, 12);
  return Math.random().toString(36).slice(2, 14);
}

// ---------------------------------------------------------------------------
// Board metadata
// ---------------------------------------------------------------------------

/**
 * The viewport a Cmd/Ctrl + wheel tick lands on, anchored under the pointer.
 *
 * Pure because the interesting part is arithmetic that is impossible to eyeball:
 * the canvas point under the cursor has to come back out at the same screen
 * position after the scale changes, and "zoomed toward the origin instead of the
 * cursor" reads as a jitter rather than as a wrong number. `point` is in
 * container coordinates -- client minus the surface's bounding rect.
 *
 * The delta curve is React Flow's own `wheelDelta` minus its pinch branch; see
 * the `onZoomWheel` comment in CanvasSurface for why that factor must not come
 * along. Returns `null` when the tick would not move the scale, so the caller
 * can skip a viewport write (and the pan/zoom events it drags behind it) at the
 * zoom limits.
 */
export function zoomViewportAtPoint(
  viewport: CanvasViewport,
  point: { x: number; y: number },
  wheel: { deltaY: number; deltaMode: number },
  limits: { minZoom: number; maxZoom: number }
): CanvasViewport | null {
  // deltaMode 1 is lines (Firefox), 2 is pages; 0 is pixels everywhere else.
  const scale =
    wheel.deltaMode === 1 ? 0.05 : wheel.deltaMode === 2 ? 1 : 0.002;
  const zoom = viewport.zoom;
  const next = Math.min(
    limits.maxZoom,
    Math.max(limits.minZoom, zoom * Math.pow(2, -wheel.deltaY * scale))
  );
  if (next === zoom || !Number.isFinite(next) || zoom === 0) return null;
  return {
    x: point.x - ((point.x - viewport.x) / zoom) * next,
    y: point.y - ((point.y - viewport.y) / zoom) * next,
    zoom: next,
  };
}

export function readCanvasViewport(
  document: CanvasDocument
): CanvasViewport | null {
  const viewport = document[NIMBALYST_CANVAS_NAMESPACE]?.meta?.viewport;
  if (
    !viewport ||
    typeof viewport.x !== 'number' ||
    typeof viewport.y !== 'number' ||
    typeof viewport.zoom !== 'number'
  ) {
    return null;
  }
  return viewport;
}

/**
 * Set the board's saved *home* view -- the frame it opens on.
 *
 * This is a deliberate edit, not a side effect of scrolling: where a user
 * happens to be looking is per-user view state the host keeps locally, and
 * writing it here would broadcast one person's viewport to the whole room.
 *
 * The values are tidied on the way in so a home view produces a one-line diff
 * rather than fourteen digits of float.
 */
export function withCanvasViewport(
  document: CanvasDocument,
  viewport: CanvasViewport
): CanvasDocument {
  const namespace = document[NIMBALYST_CANVAS_NAMESPACE] ?? {};
  const meta = namespace.meta ?? {};
  return {
    ...document,
    [NIMBALYST_CANVAS_NAMESPACE]: {
      ...namespace,
      meta: {
        ...meta,
        viewport: {
          ...meta.viewport,
          ...viewport,
          x: toCanvasCoordinate(viewport.x),
          y: toCanvasCoordinate(viewport.y),
          zoom: Math.round(viewport.zoom * 1000) / 1000,
        },
      },
    },
  };
}
