/**
 * Project Canvas surface: React Flow over a `CanvasDocument`.
 *
 * Host-agnostic on purpose -- nothing here reaches for Electron, the
 * filesystem, or a collab room, because Slice 6 publishes this same module to
 * the web console through `@nimbalyst/collab-bundle`. The document comes in as
 * a prop and every edit goes back out through `onDocumentChange`; the host
 * decides what a change means (mark dirty, save, push into a Y.Doc).
 *
 * Three decisions worth reading before changing anything here:
 *
 * **`zIndexMode="manual"` and groups are plain rank-ordered rectangles.** JSON
 * Canvas defines z-order as node array position and gives a `group` node no
 * containment semantics at all -- membership is purely geometric and children
 * keep absolute coordinates. Modelling groups as React Flow `parentId`
 * sub-flows would require `zIndexMode="auto"`, which forces every child above
 * its parent and makes the board paint in a different order than it saves; it
 * would also invent parent-relative coordinates the format does not have. So a
 * frame is just another node, its z-index is its position in rank order, and
 * `"manual"` hands that number to React Flow verbatim. The cost is that
 * "dragging a frame carries its contents" is our code rather than React Flow's
 * -- see `applyCanvasNodeChanges`.
 *
 * **`autoPanOnSelection` is off.** It defaults to `true` as of React Flow
 * 12.11. On a board where a rubber-band selection routinely runs to the edge of
 * the viewport, an automatic pan moves the cards out from under the box the
 * user is still drawing. It also collides with the activation model below,
 * which owns viewport animation. `autoPanOnNodeDrag` stays on: dragging a card
 * past the edge to move it further is what the user meant.
 *
 * **Activation is zoom-to-100** ([NIM-3845](nimbalyst://NIM-3845)). Clicking a
 * card animates the viewport to scale 1.0 centred on that card and then
 * activates it; when the viewport is already within 2% of 1.0 it activates in
 * place with no animation. Escape deactivates. Cards are pointer-inert until
 * activated -- see the header of CanvasCardNode for why that is not optional.
 *
 * **The viewport is per-user view state and never enters the document.** Where
 * you are looking is not something a teammate should inherit: activation alone
 * moves the viewport on every card click, so writing it into the shared board
 * meant one person clicking a card yanked everyone else's saved view to theirs.
 * `meta.viewport` survives as the board's deliberate *home* view -- what the
 * "Save view" button writes, and what a converted `.mockupproject` carries over
 * -- while a user's own last position rides out through `onViewportChange` for
 * the host to keep locally. The channel for "where is Sam looking" is awareness,
 * which is a different thing again and belongs to Slice 4a.
 *
 * The React Flow attribution is left visible. Hiding it is a licensing choice
 * rather than a styling one, and it also trips a development warning as of
 * 12.11.4.
 */
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  useNodesInitialized,
  useReactFlow,
  useStore,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type NodeTypes,
  type EdgeTypes,
  type Viewport,
} from '@xyflow/react';

import '@xyflow/react/dist/style.css';
import './CanvasSurface.css';

import {
  toCanvasCoordinate,
  type CanvasDocument,
  type CanvasViewport,
} from './CanvasDocument';
import type {
  CanvasAwarenessEntry,
  CanvasAwarenessPatch,
} from './canvasBinding';
import {
  CanvasCardCallbacksContext,
  CanvasCardClaimsContext,
  CanvasCardNode,
  CanvasCardRevisionsContext,
  type CanvasCardCallbacks,
  type CanvasCardRevisionsAccess,
} from './CanvasCardNode';
import {
  effectiveCanvasCardReference,
  pinCanvasRevisionCard,
  type CanvasRevisionEntry,
} from './canvasRevisions';
import {
  CanvasCardCommentsContext,
  CanvasCommentPins,
  type CanvasCardCommentsAccess,
} from './CanvasCommentsLayer';
import {
  canvasCommentTargetLabel,
  type CanvasCommentTarget,
} from './canvasComments';
import { getCanvasCallbacks } from './canvasCallbacks';
import type { CanvasCommentsModel } from './useCanvasComments';
import {
  CanvasPresenceLayer,
  CanvasPresenceRoster,
} from './CanvasPresenceLayer';
import {
  canvasCardClaimants,
  canvasPresenceParticipants,
  sameCanvasCardClaimants,
  type CanvasCardClaimant,
  type CanvasPresenceParticipant,
} from './canvasPresence';
import {
  CANVAS_EDGE_ARROW_MARKER,
  CANVAS_EDGE_ARROW_START_MARKER,
  CanvasEdgeView,
} from './CanvasEdgeView';
import {
  CANVAS_FLOW_EDGE_TYPE,
  CANVAS_FLOW_NODE_TYPE,
  EMPTY_CANVAS_GEOMETRY,
  addCanvasNode,
  applyCanvasEdgeChanges,
  applyCanvasNodeChanges,
  applyCanvasSelection,
  canvasCardLabel,
  canvasCardReference,
  canvasReferenceNodeIds,
  connectCanvasEdge,
  createNativeCanvasNode,
  readCanvasViewport,
  reorderCanvasNode,
  toFlowEdges,
  stepCanvasGesture,
  toFlowNodes,
  updateCanvasNode,
  withCanvasNodeGeometry,
  withCanvasViewport,
  type CanvasNodeGeometry,
} from './canvasFlowMapping';
import {
  CANVAS_ACTIVATION_ZOOM,
  canvasZoomBucket,
  computeCanvasCardLod,
  isCanvasActivationZoom,
  touchCanvasRecency,
  type CanvasCardLod,
} from './canvasCardLod';
import {
  CANVAS_SNAP_GRID,
  CANVAS_SNAP_THRESHOLD_PX,
  snapCanvasDrag,
  snapCanvasNodeToGrid,
  type CanvasGuide,
} from './canvasSnapping';

/**
 * The composer is the board's only late-fetched module.
 *
 * It carries `CommentComposer`, the mention picker, and `@floating-ui/react`,
 * which together were ~42 kB gzip of the `./canvas` browser entry's eager
 * graph -- paid by every reader who opens a board, spent by the few who write
 * a comment. It mounts only after "comment on this card" or a click with the
 * comment tool armed, so the fetch lands inside a gesture the user has already
 * committed to. Pins and badges stay eager: a card paints its badge on arrival.
 */
const CanvasCommentComposer = lazy(() =>
  import('./CanvasCommentComposer').then((module) => ({
    default: module.CanvasCommentComposer,
  }))
);

/** Same bargain as the composer: nobody pays for history until they open it. */
const CanvasRevisionRail = lazy(() =>
  import('./CanvasRevisionRail').then((module) => ({
    default: module.CanvasRevisionRail,
  }))
);

const ACTIVATION_DURATION_MS = 220;

const SNAP_GRID: [number, number] = [CANVAS_SNAP_GRID, CANVAS_SNAP_GRID];

const EMPTY_GUIDES: readonly CanvasGuide[] = [];

/** Joins node ids into a set key. A unit separator cannot occur inside one. */
const NODE_ID_SEPARATOR = '\u001f';

/**
 * Everyone else's in-flight boxes, as one overlay.
 *
 * This client's own entry is skipped: its frames are already painted from local
 * state, and taking the round trip back through awareness would make a card the
 * user is holding stutter between two versions of itself.
 */
function remoteMovingGeometry(
  entries: ReadonlyMap<number, CanvasAwarenessEntry> | undefined,
  localClientId: number | null
): ReadonlyMap<string, CanvasNodeGeometry> {
  if (!entries || entries.size === 0) return EMPTY_CANVAS_GEOMETRY;
  const overlay = new Map<string, CanvasNodeGeometry>();
  for (const [clientId, entry] of entries) {
    if (clientId === localClientId) continue;
    for (const geometry of entry.moving ?? []) {
      overlay.set(geometry.nodeId, {
        x: geometry.x,
        y: geometry.y,
        width: geometry.width,
        height: geometry.height,
      });
    }
  }
  return overlay.size === 0 ? EMPTY_CANVAS_GEOMETRY : overlay;
}

function sameCanvasGeometry(
  left: ReadonlyMap<string, CanvasNodeGeometry>,
  right: ReadonlyMap<string, CanvasNodeGeometry>
): boolean {
  if (left === right) return true;
  if (left.size !== right.size) return false;
  for (const [nodeId, geometry] of left) {
    const other = right.get(nodeId);
    if (
      other === undefined ||
      other.x !== geometry.x ||
      other.y !== geometry.y ||
      other.width !== geometry.width ||
      other.height !== geometry.height
    ) {
      return false;
    }
  }
  return true;
}

function sameGuides(
  left: readonly CanvasGuide[],
  right: readonly CanvasGuide[]
): boolean {
  return (
    left.length === right.length &&
    left.every((guide, index) => {
      const other = right[index];
      return (
        guide.kind === other.kind &&
        guide.x1 === other.x1 &&
        guide.y1 === other.y1 &&
        guide.x2 === other.x2 &&
        guide.y2 === other.y2
      );
    })
  );
}

/**
 * How far outside the surface a card still counts as visible.
 *
 * Screen pixels against the surface box, so at low zoom this covers more board
 * area -- which is the right way round: a card is cheaper to warm early when it
 * is small, and a pan at low zoom crosses more board per second.
 */
const VISIBILITY_MARGIN_PX = 240;

const EMPTY_LOD: ReadonlyMap<string, CanvasCardLod> = new Map();

const EMPTY_AWARENESS: ReadonlyMap<number, CanvasAwarenessEntry> = new Map();

const EMPTY_CLAIMS: ReadonlyMap<string, readonly CanvasCardClaimant[]> =
  new Map();

export interface CanvasSurfaceProps {
  document: CanvasDocument;
  onDocumentChange(next: CanvasDocument): void;
  /**
   * Ends the current undo step. Called at every gesture boundary -- a drag
   * starting or stopping, and each discrete edit -- so that two gestures inside
   * the undo manager's capture window do not collapse into one.
   */
  onEditBoundary?(): void;
  /**
   * Where this user is looking, after every pan or zoom. Per-user view state:
   * the host keeps it locally and hands it back as `initialViewport`. It is not
   * the board's `meta.viewport`, which only the "Save view" button writes.
   */
  onViewportChange?(viewport: CanvasViewport): void;
  /** This user's last view of this board, if the host remembers one. */
  initialViewport?: CanvasViewport | null;
  /** Outbound presence: this user's cursor, viewport, and selection. */
  onAwarenessChange?(patch: CanvasAwarenessPatch): void;
  /** Inbound presence: everyone on the board, including this client's entry. */
  awarenessEntries?: ReadonlyMap<number, CanvasAwarenessEntry>;
  /** This client's awareness id, so its own cursor is not drawn back to it. */
  localClientId?: number | null;
  /** Shared parents resolve a file card's `sharedAs` child binding. */
  collaborative?: boolean;
  /**
   * Comment threads anchored to this board. Absent on a board with no comment
   * room, which is every private `.canvas` file -- the affordances disappear
   * rather than pretending to write somewhere.
   */
  comments?: CanvasCommentsModel;
  readOnly?: boolean;
}

const NODE_TYPES: NodeTypes = { [CANVAS_FLOW_NODE_TYPE]: CanvasCardNode };
const EDGE_TYPES: EdgeTypes = { [CANVAS_FLOW_EDGE_TYPE]: CanvasEdgeView };
const DELETE_KEYS = ['Backspace', 'Delete'];

export function CanvasSurface(props: CanvasSurfaceProps): ReactElement {
  return (
    <ReactFlowProvider>
      <CanvasSurfaceInner {...props} />
    </ReactFlowProvider>
  );
}

function CanvasSurfaceInner({
  document,
  onDocumentChange,
  onEditBoundary,
  onViewportChange,
  initialViewport = null,
  onAwarenessChange,
  awarenessEntries,
  localClientId = null,
  collaborative = false,
  comments,
  readOnly = false,
}: CanvasSurfaceProps): ReactElement {
  const flow = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const documentRef = useRef(document);
  // Event handlers must use the projection that is actually painted. Updating
  // this during render would let an old DOM event observe a remote projection
  // that React has not committed yet and manufacture a stale whole-document
  // edit from two different snapshots.
  useLayoutEffect(() => {
    documentRef.current = document;
  }, [document]);

  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set<string>()
  );
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const activationToken = useRef(0);
  // A drag ends with a click event on the same card. Without this the gesture
  // that moved a card would also activate it and animate the viewport.
  const draggedRef = useRef(false);
  const pointerFrameRef = useRef<number | null>(null);
  const pendingPointerRef = useRef<{ x: number; y: number } | null>(null);

  // Alignment guides are transient view state: they are recomputed from every
  // drag frame and thrown away when the drag ends. Nothing here is ever handed
  // to `onDocumentChange`, so no path exists by which a guide reaches the file,
  // the Y.Doc, or undo history.
  const [guides, setGuides] = useState<readonly CanvasGuide[]>(EMPTY_GUIDES);

  /**
   * Alt/Option held suspends the grid, alignment, and spacing snaps together.
   *
   * The other obvious modifiers are already spoken for by React Flow: Shift
   * draws a selection box, Meta/Control multi-selects and gates zoom, Space
   * activates panning. Alt is free, and "hold this to put the thing exactly
   * where the pointer is" is the meaning it usually carries anyway.
   */
  const [snapDefeated, setSnapDefeated] = useState(false);
  const snapDefeatedRef = useRef(false);
  snapDefeatedRef.current = snapDefeated;

  // Bucketed, not raw: see `canvasZoomBucket`. Subscribing here rather than
  // reading `flow.getZoom()` imperatively is what makes a card go inert the
  // instant the band is crossed, whichever of React Flow's many zoom paths did
  // it -- the Controls buttons, ctrl+wheel, the minimap, `fitView`.
  const zoom = useStore((state) => canvasZoomBucket(state.transform[2]));

  // `toFlowNodes` gates on the same rule, and it is the gate that matters; this
  // only keeps the surface's own state from disagreeing with what it painted.
  const hotNodeId = isCanvasActivationZoom(zoom) ? activeNodeId : null;

  // Mount and unmount are the only expensive thing a card does, so neither
  // happens while the user is still moving. See `CanvasLodInput.gestureActive`.
  const [gestureActive, setGestureActive] = useState(false);

  const referenceIds = useMemo(
    () => canvasReferenceNodeIds(document),
    [document]
  );
  const { lod, observeCard } = useCanvasCardLod({
    referenceIds,
    hotId: hotNodeId,
    zoom,
    gestureActive,
    surfaceRef: wrapperRef,
  });

  /**
   * Boxes that are moving under a pointer right now -- this user's or anyone
   * else's -- painted over the document without being written to it.
   *
   * Held apart from `document` for two different reasons at once. Locally, it is
   * what keeps a drag from spending a Y.Doc transaction, an outbox row, and a
   * renderer-to-main IPC call on every pointer frame (`canvasGestureKind`).
   * Remotely, it is how a teammate's drag is drawn live: their frames arrive as
   * awareness, so a card slides across everyone's board without any client
   * persisting a position the person dragging has not settled on yet.
   */
  const [localGeometry, setLocalGeometry] = useState<
    ReadonlyMap<string, CanvasNodeGeometry>
  >(EMPTY_CANVAS_GEOMETRY);
  const localGeometryRef = useRef(localGeometry);
  localGeometryRef.current = localGeometry;

  // Cached by value, for the same reason `claims` below is: a teammate moving
  // their pointer republishes their whole awareness entry many times a second,
  // and a fresh map each time would repaint every card on the board even when
  // nobody is dragging anything.
  const remoteGeometryRef = useRef(EMPTY_CANVAS_GEOMETRY);
  const remoteGeometry = useMemo(() => {
    const next = remoteMovingGeometry(awarenessEntries, localClientId);
    if (sameCanvasGeometry(remoteGeometryRef.current, next)) {
      return remoteGeometryRef.current;
    }
    remoteGeometryRef.current = next;
    return next;
  }, [awarenessEntries, localClientId]);

  // Local wins: this user's own frames are ahead of the round trip that would
  // bring them back through awareness, and a card must never stutter between
  // the two.
  const liveGeometry = useMemo(() => {
    if (localGeometry.size === 0) return remoteGeometry;
    if (remoteGeometry.size === 0) return localGeometry;
    return new Map([...remoteGeometry, ...localGeometry]);
  }, [localGeometry, remoteGeometry]);

  /**
   * The board as painted: the document plus whatever is mid-gesture.
   *
   * Only React Flow, the edges, and presence read this. Everything that acts on
   * the board -- activation, comment anchoring, adding a card, saving the home
   * view -- goes through `documentRef`, because those are answers about what the
   * board *is*, and a box somebody is still holding is not that yet.
   */
  const paintedDocument = useMemo(
    () => withCanvasNodeGeometry(document, liveGeometry),
    [document, liveGeometry]
  );

  const nodes = useMemo(
    () =>
      toFlowNodes(paintedDocument, {
        activeNodeId,
        zoom,
        lod,
        selectedIds,
        readOnly,
      }),
    [paintedDocument, activeNodeId, zoom, lod, selectedIds, readOnly]
  );
  const edges = useMemo(
    () => toFlowEdges(paintedDocument, { selectedIds, readOnly }),
    [paintedDocument, selectedIds, readOnly]
  );

  const participants = useMemo(
    () =>
      canvasPresenceParticipants(awarenessEntries ?? EMPTY_AWARENESS, {
        ...(localClientId === null ? {} : { localClientId }),
      }),
    [awarenessEntries, localClientId]
  );

  // Claims are cached by value, not by the identity of the awareness map that
  // produced them: a teammate moving their pointer republishes their whole
  // entry many times a second, and every one of those ticks would otherwise
  // hand the card context a new object and re-render every card on the board.
  const claimsRef =
    useRef<ReadonlyMap<string, readonly CanvasCardClaimant[]>>(EMPTY_CLAIMS);
  const claims = useMemo(() => {
    const next = canvasCardClaimants(participants);
    if (sameCanvasCardClaimants(claimsRef.current, next)) {
      return claimsRef.current;
    }
    claimsRef.current = next;
    return next;
  }, [participants]);

  const jumpToParticipant = useCallback(
    (participant: CanvasPresenceParticipant) => {
      const rect = participant.viewport;
      if (!rect || rect.width <= 0 || rect.height <= 0) return;
      // Cancels any in-flight activation for the same reason a pane click does:
      // the user just asked to look somewhere else.
      activationToken.current += 1;
      void flow.fitBounds(rect, {
        padding: 0.02,
        duration: ACTIVATION_DURATION_MS,
      });
    },
    [flow]
  );

  const deactivate = useCallback(() => {
    activationToken.current += 1;
    setActiveNodeId(null);
  }, []);

  const activate = useCallback(
    (nodeId: string) => {
      const node = (documentRef.current.nodes ?? []).find(
        (candidate) => candidate.id === nodeId
      );
      if (!node) return;
      if (isCanvasActivationZoom(flow.getZoom())) {
        setActiveNodeId(nodeId);
        return;
      }
      const token = (activationToken.current += 1);
      void flow
        .setCenter(node.x + node.width / 2, node.y + node.height / 2, {
          zoom: CANVAS_ACTIVATION_ZOOM,
          duration: ACTIVATION_DURATION_MS,
        })
        .then(() => {
          // A second click, a pane click, or Escape during the animation bumps
          // the token; activating then would fight whatever the user just did.
          if (activationToken.current === token) setActiveNodeId(nodeId);
        });
    },
    [flow]
  );

  useEffect(() => {
    if (activeNodeId === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') deactivate();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeNodeId, deactivate]);

  // ---------------------------------------------------------------------
  // Comments: where a thread sits on the board, and how to get to it.
  // ---------------------------------------------------------------------

  /** The target a composer is open for, or null. */
  const [pendingComment, setPendingComment] =
    useState<CanvasCommentTarget | null>(null);
  /** Armed by the toolbar; the next pane click drops a pin there. */
  const [pinPlacement, setPinPlacement] = useState(false);

  const nodeLabelOf = useCallback((nodeId: string): string | null => {
    const node = (documentRef.current.nodes ?? []).find(
      (candidate) => candidate.id === nodeId
    );
    return node === undefined ? null : canvasCardLabel(node);
  }, []);

  /**
   * Bring a thread's target into view. Registered with the comment wiring, so
   * clicking a thread in the host's panel moves this board -- the one thing the
   * panel cannot do for itself.
   */
  const focusCommentTarget = useCallback(
    (target: CanvasCommentTarget): boolean => {
      activationToken.current += 1;
      if (target.kind === 'point') {
        void flow.setCenter(target.point.x, target.point.y, {
          zoom: flow.getZoom(),
          duration: ACTIVATION_DURATION_MS,
        });
        return true;
      }
      const node = (documentRef.current.nodes ?? []).find(
        (candidate) => candidate.id === target.nodeId
      );
      if (!node) return false;
      setSelectedIds(new Set([node.id]));
      void flow.setCenter(node.x + node.width / 2, node.y + node.height / 2, {
        zoom: flow.getZoom(),
        duration: ACTIVATION_DURATION_MS,
      });
      return true;
    },
    [flow]
  );

  useEffect(() => {
    if (!comments) return;
    comments.registerFocus(focusCommentTarget);
    return () => comments.registerFocus(null);
  }, [comments, focusCommentTarget]);

  const openCardThread = useCallback(
    (nodeId: string) => {
      const thread = comments?.threads.find(
        (candidate) =>
          candidate.target.kind === 'node' &&
          candidate.target.nodeId === nodeId &&
          !candidate.resolved
      );
      if (thread) comments?.openThread(thread.threadId);
    },
    [comments]
  );

  /**
   * The `@agent` ask this user is being asked about, one at a time.
   *
   * Oldest first, and one at a time on purpose: this is a consent prompt, and a
   * stack of them is how consent turns into a "yes" button people learn to hit
   * without reading. Anyone in the room can put one here -- see
   * `canvasPendingAgentRequests` -- so the queue has to stay a queue.
   */
  const agentRequest = comments?.agentRequests[0];

  const cardComments = useMemo<CanvasCardCommentsAccess | null>(
    () =>
      comments?.enabled === true
        ? {
            counts: comments.counts,
            canComment: comments.canComment,
            onOpenCardThread: openCardThread,
            onCommentOnCard: (nodeId) => {
              setPinPlacement(false);
              setPendingComment({ kind: 'node', nodeId });
            },
          }
        : null,
    [comments, openCardThread]
  );

  // ---------------------------------------------------------------------
  // Revisions: one card's history at a time, and pinning one as a new card.
  // ---------------------------------------------------------------------

  /** The card whose rail is open, or null. */
  const [revisionsNodeId, setRevisionsNodeId] = useState<string | null>(null);

  const revisionSource = getCanvasCallbacks().revisions;

  const cardRevisions = useMemo<CanvasCardRevisionsAccess | null>(
    () =>
      revisionSource === undefined
        ? null
        : { onOpenRevisions: (nodeId) => setRevisionsNodeId(nodeId) },
    [revisionSource]
  );

  /**
   * The open rail's card, re-derived from the live document rather than
   * captured when it opened: the card can be moved, relabelled, or deleted by a
   * teammate while the rail is up, and a rail pointing at a node that no longer
   * exists must close rather than describe it.
   */
  const revisionCard = useMemo(() => {
    if (revisionsNodeId === null) return null;
    const node = (document.nodes ?? []).find(
      (candidate) => candidate.id === revisionsNodeId
    );
    if (!node) return null;
    const reference = effectiveCanvasCardReference(canvasCardReference(node), {
      preferShared: collaborative,
    });
    return reference === null
      ? null
      : { nodeId: node.id, reference, label: canvasCardLabel(node) };
  }, [collaborative, document, revisionsNodeId]);

  useEffect(() => {
    if (revisionsNodeId !== null && revisionCard === null) {
      setRevisionsNodeId(null);
    }
  }, [revisionCard, revisionsNodeId]);

  const submitPendingComment = useCallback(
    (text: string, mentionedUserIds: string[]) => {
      const target = pendingComment;
      if (!target || !comments) return;
      setPendingComment(null);
      void comments.createThread(target, text, mentionedUserIds);
    },
    [comments, pendingComment]
  );

  /**
   * A pane click either drops a pin or deactivates the hot card.
   *
   * Placement is a one-shot mode rather than a persistent tool: dropping a pin
   * disarms it, so a user who came to leave one remark does not then have to
   * remember to turn the tool off before they can click the board again.
   */
  const onPaneClick = useCallback(
    (event: ReactMouseEvent) => {
      if (!pinPlacement || !comments?.canComment) {
        deactivate();
        return;
      }
      setPinPlacement(false);
      const point = flow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      setPendingComment({
        kind: 'point',
        point: {
          x: toCanvasCoordinate(point.x),
          y: toCanvasCoordinate(point.y),
        },
      });
    },
    [comments, deactivate, flow, pinPlacement]
  );

  // Zooming away from 1.0 while a card is hot drops the activation entirely
  // rather than leaving state pointing at a card the mapping has already turned
  // inert. Deliberately not a re-activation on the way back: the user zoomed
  // out to look at the board, and having a card silently grab the keyboard again
  // when they zoom back in is not what they asked for.
  useEffect(() => {
    if (activeNodeId !== null && hotNodeId === null) deactivate();
  }, [activeNodeId, hotNodeId, deactivate]);

  // A discrete edit closes the previous undo step before opening its own; a
  // continuous one (dragging, typing into a card) deliberately does not, so a
  // gesture stays a single undo.
  const commit = useCallback(
    (next: CanvasDocument) => {
      if (next === documentRef.current) return;
      onEditBoundary?.();
      onDocumentChange(next);
    },
    [onDocumentChange, onEditBoundary]
  );

  /**
   * Pin a revision as its own card.
   *
   * The entire write is `pinCanvasRevisionCard`, which only ever appends -- the
   * card the rail was opened from is returned untouched. There is deliberately
   * no counterpart that writes a revision back over head; see the header of
   * `canvasRevisions.ts`.
   */
  const pinRevision = useCallback(
    (entry: CanvasRevisionEntry) => {
      if (revisionsNodeId === null || readOnly) return;
      commit(
        pinCanvasRevisionCard(documentRef.current, {
          sourceNodeId: revisionsNodeId,
          revisionId: entry.revisionId,
          sequence: entry.sequence,
        })
      );
    },
    [commit, readOnly, revisionsNodeId]
  );

  /**
   * The running gesture, as presence.
   *
   * Ephemeral by construction: awareness carries no history, is dropped when
   * this client disconnects, and never reaches the outbox. A card left mid-drag
   * by a lost connection therefore snaps back to its last committed position on
   * every other board rather than sticking where the pointer died.
   */
  const publishMovingAwareness = useCallback(
    (overlay: ReadonlyMap<string, CanvasNodeGeometry>) => {
      if (!onAwarenessChange) return;
      onAwarenessChange({
        moving:
          overlay.size === 0
            ? null
            : [...overlay].map(([nodeId, geometry]) => ({
                nodeId,
                ...geometry,
              })),
      });
    },
    [onAwarenessChange]
  );

  const guidesRef = useRef(guides);
  guidesRef.current = guides;
  const showGuides = useCallback((next: readonly CanvasGuide[]) => {
    // Compared before setting: this runs on every frame of a drag, and an
    // unchanged guide set must not cost the board a second render.
    if (sameGuides(guidesRef.current, next)) return;
    guidesRef.current = next;
    setGuides(next);
  }, []);

  /**
   * Rewrite a single-card drag to its magnetically snapped position.
   *
   * One card at a time on purpose: a multi-card drag has no single rectangle to
   * align, and React Flow's own grid snap already keeps the group tidy. The
   * incoming position is grid-snapped by React Flow, so an alignment match here
   * is a deliberate override of the grid.
   *
   * The change that *ends* the drag (`dragging: false`) has to be snapped too.
   * React Flow re-emits the raw gridded position when the pointer comes up, so
   * skipping it would silently undo the snap the moment the user let go -- the
   * card would sit aligned for the whole drag and then jump back to the grid.
   * Guides are still cleared on that change, because the gesture is over.
   */
  const withDragSnapping = useCallback(
    (
      changes: readonly NodeChange[],
      base: CanvasDocument
    ): readonly NodeChange[] => {
      const dragging = changes.filter(
        (change): change is Extract<NodeChange, { type: 'position' }> =>
          change.type === 'position' &&
          change.dragging !== undefined &&
          change.position !== undefined
      );
      // A batch with no position change in it says nothing about the drag.
      // Every frame of a drag also delivers a second batch carrying no position
      // at all, once the edited document round-trips back into React Flow, and
      // reading that as "no drag" wiped the guides before they could ever
      // paint -- the snap worked and the board stayed blank.
      if (dragging.length === 0) return changes;
      if (snapDefeatedRef.current || dragging.length !== 1) {
        showGuides(EMPTY_GUIDES);
        return changes;
      }

      const change = dragging[0];
      const nodes = base.nodes ?? [];
      const moving = nodes.find((node) => node.id === change.id);
      if (!moving || !change.position) {
        showGuides(EMPTY_GUIDES);
        return changes;
      }

      const snapped = snapCanvasDrag(
        {
          x: change.position.x,
          y: change.position.y,
          width: moving.width,
          height: moving.height,
        },
        nodes
          .filter((node) => node.id !== moving.id)
          .map((node) => ({
            id: node.id,
            x: node.x,
            y: node.y,
            width: node.width,
            height: node.height,
          })),
        // Screen pixels, so the pull feels the same at every zoom.
        CANVAS_SNAP_THRESHOLD_PX / Math.max(flow.getZoom(), 0.01)
      );
      showGuides(change.dragging === true ? snapped.guides : EMPTY_GUIDES);
      if (snapped.x === change.position.x && snapped.y === change.position.y) {
        return changes;
      }
      return changes.map((entry) =>
        entry === change
          ? { ...entry, position: { x: snapped.x, y: snapped.y } }
          : entry
      );
    },
    [flow, showGuides]
  );

  /**
   * React Flow's change stream, routed by what it costs to keep.
   *
   * Every judgement in here is `stepCanvasGesture`'s, deliberately: mid-gesture
   * frames become held geometry and an awareness broadcast, and only the frame
   * that ends the gesture is folded into the document, so one drag is one
   * durable write rather than sixty. This handler is the wiring around that
   * decision and should stay that way -- read that function before changing the
   * shape of anything here.
   */
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setSelectedIds((current) => applyCanvasSelection(current, changes));
      if (readOnly) return;

      const step = stepCanvasGesture(
        documentRef.current,
        localGeometryRef.current,
        changes,
        withDragSnapping
      );

      if (step.commit !== null) {
        if (changes.some((change) => change.type === 'remove')) {
          onEditBoundary?.();
        }
        onDocumentChange(step.commit);
      }
      if (step.held !== localGeometryRef.current) {
        // Written straight to the ref as well as to state: two change batches
        // can land in one tick, and the second must fold against the first
        // rather than against whatever the last render happened to see. Both
        // updates batch with the commit above, so the document arrives in the
        // same render the overlay is dropped in and a card that has just been
        // let go never flashes back to where the gesture started.
        localGeometryRef.current = step.held;
        setLocalGeometry(step.held);
        publishMovingAwareness(step.held);
      }
      if (step.kind === 'boundary') {
        showGuides(EMPTY_GUIDES);
        onEditBoundary?.();
      }
    },
    [
      onDocumentChange,
      onEditBoundary,
      publishMovingAwareness,
      readOnly,
      showGuides,
      withDragSnapping,
    ]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setSelectedIds((current) => applyCanvasSelection(current, changes));
      if (readOnly) return;
      commit(applyCanvasEdgeChanges(documentRef.current, changes));
    },
    [commit, readOnly]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (readOnly) return;
      commit(connectCanvasEdge(documentRef.current, connection));
    },
    [commit, readOnly]
  );

  const publishViewportAwareness = useCallback(() => {
    if (!onAwarenessChange) return;
    const bounds = wrapperRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width === 0 || bounds.height === 0) return;
    const topLeft = flow.screenToFlowPosition({
      x: bounds.left,
      y: bounds.top,
    });
    const bottomRight = flow.screenToFlowPosition({
      x: bounds.right,
      y: bounds.bottom,
    });
    onAwarenessChange({
      viewport: {
        x: topLeft.x,
        y: topLeft.y,
        width: Math.max(0, bottomRight.x - topLeft.x),
        height: Math.max(0, bottomRight.y - topLeft.y),
      },
    });
  }, [flow, onAwarenessChange]);

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!onAwarenessChange) return;
      pendingPointerRef.current = { x: event.clientX, y: event.clientY };
      if (pointerFrameRef.current !== null) return;
      pointerFrameRef.current = requestAnimationFrame(() => {
        pointerFrameRef.current = null;
        const pointer = pendingPointerRef.current;
        pendingPointerRef.current = null;
        if (!pointer) return;
        onAwarenessChange({ cursor: flow.screenToFlowPosition(pointer) });
      });
    },
    [flow, onAwarenessChange]
  );

  const onPointerLeave = useCallback(() => {
    pendingPointerRef.current = null;
    if (pointerFrameRef.current !== null) {
      cancelAnimationFrame(pointerFrameRef.current);
      pointerFrameRef.current = null;
    }
    onAwarenessChange?.({ cursor: null });
  }, [onAwarenessChange]);

  useEffect(
    () => () => {
      if (pointerFrameRef.current !== null) {
        cancelAnimationFrame(pointerFrameRef.current);
      }
      // A board closed mid-drag must not leave a card haloed at a position
      // nobody is holding any more. The binding clears the whole field on its
      // own teardown; this covers the surface unmounting first.
      if (localGeometryRef.current.size > 0) {
        publishMovingAwareness(EMPTY_CANVAS_GEOMETRY);
      }
    },
    [publishMovingAwareness]
  );

  /**
   * The one card this user has selected, when it is exactly one.
   *
   * Keyed on the board's *id set* rather than on `document.nodes`. The array
   * identity changes on every edit anyone makes -- a teammate typing into a
   * card, a rank moving, any frame of any gesture -- and re-running this effect
   * for those republished a selection that had not changed, so ordinary
   * document work turned into presence traffic carrying nothing. The set is what
   * this effect actually depends on: the only thing a node change can do to a
   * selection is take its card away.
   */
  const nodeIdKey = useMemo(
    () =>
      (document.nodes ?? [])
        .map((node) => node.id)
        .sort()
        .join(NODE_ID_SEPARATOR),
    [document.nodes]
  );
  useEffect(() => {
    if (!onAwarenessChange) return;
    const present = new Set(
      nodeIdKey === '' ? [] : nodeIdKey.split(NODE_ID_SEPARATOR)
    );
    const selectedNodes = [...selectedIds].filter((id) => present.has(id));
    onAwarenessChange({
      selectedNodeId: selectedNodes.length === 1 ? selectedNodes[0] : null,
    });
  }, [nodeIdKey, onAwarenessChange, selectedIds]);

  // Pan and zoom go to the host as this user's view, never into the document.
  const onMoveEnd = useCallback(
    (_event: unknown, viewport: Viewport) => {
      setGestureActive(false);
      onViewportChange?.(viewport);
      publishViewportAwareness();
    },
    [onViewportChange, publishViewportAwareness]
  );

  /** Write the current view into the board as its home view. A real edit. */
  const saveHomeView = useCallback(() => {
    commit(withCanvasViewport(documentRef.current, flow.getViewport()));
  }, [commit, flow]);

  const cardCallbacks = useMemo<CanvasCardCallbacks>(
    () => ({
      observeCard,
      preferSharedReferences: collaborative,
      onPatchNode: (id, patch) => {
        if (readOnly) return;
        // Continuous: typing into a card undoes as a sentence, not a letter.
        const next = updateCanvasNode(documentRef.current, id, patch);
        if (next !== documentRef.current) onDocumentChange(next);
      },
      onReorderNode: (id, placement) => {
        if (readOnly) return;
        commit(reorderCanvasNode(documentRef.current, id, placement));
      },
      onDeleteNode: (id) => {
        if (readOnly) return;
        commit(
          applyCanvasNodeChanges(documentRef.current, [{ id, type: 'remove' }])
        );
      },
    }),
    [collaborative, commit, observeCard, onDocumentChange, readOnly]
  );

  const addCard = useCallback(
    (kind: 'sticky' | 'text' | 'image' | 'group') => {
      const bounds = wrapperRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const center = flow.screenToFlowPosition({
        x: bounds.left + bounds.width / 2,
        y: bounds.top + bounds.height / 2,
      });
      const node = createNativeCanvasNode(documentRef.current, kind, center);
      // The card's *origin* is what has to land on the grid, so snapping the
      // pointer instead -- `screenToFlowPosition`'s own `snapGrid` -- would not
      // do it: a new card is centred on that point, and half of 180 is not a
      // multiple of 20.
      const placed = snapDefeated ? node : snapCanvasNodeToGrid(node);
      commit(addCanvasNode(documentRef.current, placed));
      setSelectedIds(new Set([placed.id]));
    },
    [commit, flow, snapDefeated]
  );

  // Restore this user's own last view if the host remembers one, then the
  // board's saved home view, and otherwise frame the cards. Read once: React
  // Flow owns the viewport after mount, and re-applying it on every document
  // change would yank the board back mid-pan -- which is also exactly what a
  // teammate's pan used to do when the viewport lived in the shared document.
  const savedViewport = useRef(
    initialViewport ?? readCanvasViewport(document)
  ).current;

  // Fit after the nodes are measured, not via the `fitView` prop. The prop fits
  // at init, when the cards have no measured box yet, and the resulting zoom
  // clamps to `minZoom` -- the board opens at 10%. Waiting on
  // `useNodesInitialized` is the same fix the old mockup canvas made with a
  // ladder of setTimeouts, without guessing at a delay.
  const nodesInitialized = useNodesInitialized();
  const hasFitRef = useRef(savedViewport !== null);
  useEffect(() => {
    if (hasFitRef.current || !nodesInitialized) return;
    hasFitRef.current = true;
    void flow.fitView({ padding: 0.2, maxZoom: 1 });
  }, [nodesInitialized, flow]);

  useEffect(() => {
    if (!nodesInitialized || !onAwarenessChange) return;
    const frame = requestAnimationFrame(publishViewportAwareness);
    return () => cancelAnimationFrame(frame);
  }, [nodesInitialized, onAwarenessChange, publishViewportAwareness]);

  // Read `altKey` off the event rather than matching `event.key`: on macOS
  // Option changes the character a key produces, so the keydown that arrives
  // while snapping is defeated frequently is not named 'Alt' at all. The blur
  // reset stops a modifier released outside the window from sticking on.
  useEffect(() => {
    const sync = (event: KeyboardEvent) => setSnapDefeated(event.altKey);
    const release = () => setSnapDefeated(false);
    window.addEventListener('keydown', sync);
    window.addEventListener('keyup', sync);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('keydown', sync);
      window.removeEventListener('keyup', sync);
      window.removeEventListener('blur', release);
    };
  }, []);

  return (
    <div
      className="canvas-surface"
      ref={wrapperRef}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      <svg className="canvas-surface__markers" width={0} height={0} aria-hidden>
        <defs>
          <marker
            id={CANVAS_EDGE_ARROW_MARKER}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--nim-text-faint)" />
          </marker>
          <marker
            id={CANVAS_EDGE_ARROW_START_MARKER}
            viewBox="0 0 10 10"
            refX="2"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto"
          >
            <path d="M 10 0 L 0 5 L 10 10 z" fill="var(--nim-text-faint)" />
          </marker>
        </defs>
      </svg>

      {/* The provider wraps <ReactFlow>, not its children: card components are
          rendered by React Flow's own node renderer, which is a sibling of the
          children we pass in, so a provider placed inside would never reach
          them. */}
      <CanvasCardCallbacksContext.Provider value={cardCallbacks}>
        <CanvasCardCommentsContext.Provider value={cardComments}>
        <CanvasCardRevisionsContext.Provider value={cardRevisions}>
        <CanvasCardClaimsContext.Provider value={claims}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onMoveStart={() => setGestureActive(true)}
            onMoveEnd={onMoveEnd}
            onNodeDragStart={() => {
              draggedRef.current = false;
              // Close whatever step preceded this drag, so "move a card, move
              // another card" is two undos rather than one.
              onEditBoundary?.();
            }}
            onNodeDrag={() => {
              draggedRef.current = true;
            }}
            onNodeClick={(_event, node) => {
              if (draggedRef.current) {
                draggedRef.current = false;
                return;
              }
              activate(node.id);
            }}
            onPaneClick={onPaneClick}
            defaultViewport={savedViewport ?? undefined}
            minZoom={0.1}
            maxZoom={2}
            snapToGrid={!snapDefeated}
            snapGrid={SNAP_GRID}
            zIndexMode="manual"
            elevateNodesOnSelect={false}
            autoPanOnSelection={false}
            nodesDraggable={!readOnly}
            nodesConnectable={!readOnly}
            elementsSelectable
            deleteKeyCode={readOnly ? null : DELETE_KEYS}
            proOptions={{ hideAttribution: false }}
            className="canvas-surface__flow"
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={20}
              size={1}
              color="var(--nim-border)"
            />
            <ViewportPortal>
              <svg
                className="canvas-guides"
                aria-hidden
                width={0}
                height={0}
                // Inside the transformed viewport, so the endpoints below are
                // plain canvas coordinates and the guides move with the board.
                // `overflow: visible` is what lets a line drawn at a negative
                // coordinate paint at all.
                style={{ position: 'absolute', overflow: 'visible' }}
              >
                {guides.map((guide) => (
                  <line
                    key={`${guide.kind}:${guide.x1},${guide.y1},${guide.x2},${guide.y2}`}
                    className={`canvas-guides__line canvas-guides__line--${guide.kind}`}
                    x1={guide.x1}
                    y1={guide.y1}
                    x2={guide.x2}
                    y2={guide.y2}
                  />
                ))}
              </svg>
            </ViewportPortal>
            <CanvasPresenceLayer
              participants={participants}
              nodes={paintedDocument.nodes ?? []}
            />
            {comments?.enabled === true && (
              <CanvasCommentPins
                threads={comments.threads}
                onOpenThread={comments.openThread}
              />
            )}
            {pendingComment !== null && comments !== undefined && (
              <Panel position="bottom-left" className="canvas-comment-panel">
                <Suspense fallback={null}>
                  <CanvasCommentComposer
                    target={pendingComment}
                    targetLabel={canvasCommentTargetLabel(
                      pendingComment,
                      nodeLabelOf
                    )}
                    getMembers={comments.getMembers}
                    onSubmit={submitPendingComment}
                    onCancel={() => setPendingComment(null)}
                  />
                </Suspense>
              </Panel>
            )}
            {agentRequest !== undefined && (
              <Panel
                position="bottom-center"
                className="canvas-agent-request"
                data-canvas-agent-request={agentRequest.commentId}
              >
                <div className="canvas-agent-request__title">
                  Start a session for this comment?
                </div>
                <div className="canvas-agent-request__where">
                  {agentRequest.anchorLabel}
                </div>
                <blockquote className="canvas-agent-request__body select-text">
                  {agentRequest.body.trim()}
                </blockquote>
                <p className="canvas-agent-request__warning">
                  This comment came from the shared board and nothing has
                  verified who wrote it. A session runs here, in this workspace,
                  with your permissions. Start it only if you recognise the
                  request.
                </p>
                <div className="canvas-agent-request__actions">
                  <button
                    type="button"
                    className="canvas-agent-request__button canvas-agent-request__button--dismiss"
                    onClick={() =>
                      comments?.dismissAgentRequest(agentRequest.commentId)
                    }
                  >
                    Not now
                  </button>
                  <button
                    type="button"
                    className="canvas-agent-request__button canvas-agent-request__button--confirm"
                    onClick={() =>
                      comments?.confirmAgentRequest(agentRequest.commentId)
                    }
                  >
                    Start session
                  </button>
                </div>
              </Panel>
            )}
            {revisionCard !== null && revisionSource !== undefined && (
              <Panel position="bottom-right" className="canvas-revision-panel">
                <Suspense fallback={null}>
                  <CanvasRevisionRail
                    nodeId={revisionCard.nodeId}
                    label={revisionCard.label || revisionCard.nodeId}
                    reference={revisionCard.reference}
                    source={revisionSource}
                    canPin={!readOnly}
                    onPin={pinRevision}
                    onClose={() => setRevisionsNodeId(null)}
                  />
                </Suspense>
              </Panel>
            )}
            <Panel position="top-right" className="canvas-presence-panel">
              <CanvasPresenceRoster
                participants={participants}
                onJumpTo={jumpToParticipant}
              />
            </Panel>
            <Controls showInteractive={false} />
            <MiniMap
              pannable
              zoomable
              maskColor="color-mix(in srgb, var(--nim-bg) 65%, transparent)"
              style={{ background: 'var(--nim-bg)' }}
            />
            {!readOnly && (
              <Panel position="top-left" className="canvas-toolbar">
                <button
                  type="button"
                  className="canvas-toolbar__button"
                  onClick={() => addCard('sticky')}
                >
                  Sticky
                </button>
                <button
                  type="button"
                  className="canvas-toolbar__button"
                  onClick={() => addCard('text')}
                >
                  Text
                </button>
                <button
                  type="button"
                  className="canvas-toolbar__button"
                  onClick={() => addCard('image')}
                >
                  Image
                </button>
                <button
                  type="button"
                  className="canvas-toolbar__button"
                  onClick={() => addCard('group')}
                >
                  Frame
                </button>
                {comments?.canComment === true && (
                  <button
                    type="button"
                    className={`canvas-toolbar__button${
                      pinPlacement ? ' canvas-toolbar__button--armed' : ''
                    }`}
                    aria-pressed={pinPlacement}
                    onClick={() => {
                      setPendingComment(null);
                      setPinPlacement((armed) => !armed);
                    }}
                    title="Drop a comment pin anywhere on the board"
                  >
                    Pin
                  </button>
                )}
                <button
                  type="button"
                  className="canvas-toolbar__button canvas-toolbar__button--view"
                  onClick={saveHomeView}
                  title="Store the current position and zoom as this board's starting view"
                >
                  Save view
                </button>
              </Panel>
            )}
          </ReactFlow>
        </CanvasCardClaimsContext.Provider>
        </CanvasCardRevisionsContext.Provider>
        </CanvasCardCommentsContext.Provider>
      </CanvasCardCallbacksContext.Provider>

      {(document.nodes ?? []).length === 0 && (
        <div className="canvas-surface__empty">
          {readOnly
            ? 'This board is empty.'
            : 'Empty board. Add a sticky, text, image, or frame to start.'}
        </div>
      )}
    </div>
  );
}

interface CanvasCardLodOptions {
  referenceIds: readonly string[];
  hotId: string | null;
  /** Already bucketed by `canvasZoomBucket`. */
  zoom: number;
  /** True between `onMoveStart` and `onMoveEnd`. */
  gestureActive: boolean;
  surfaceRef: { current: HTMLElement | null };
}

/**
 * Drives `computeCanvasCardLod` from the DOM.
 *
 * Everything genuinely decision-shaped is in the pure function; this is the
 * observation layer, and it has exactly two jobs beyond wiring.
 *
 * **It refuses intersection batches observed while the surface has no box.**
 * Nimbalyst keeps every mode component mounted and hides the inactive ones with
 * `display: none`, so in Agent mode this whole subtree measures 0x0 and
 * `IntersectionObserver` delivers a confident `isIntersecting: false` for every
 * card. Folding that in would demote the entire board and unmount thirty
 * editors, and the user gets that for free every time they glance at a
 * transcript. The check is a synchronous read of the surface's own box inside
 * the callback rather than a flag set by the ResizeObserver, because the
 * ordering of the two observers is not specified and a flag can be one frame
 * stale in exactly the direction that hurts.
 *
 * **It reports hiddenness so the pure function can freeze.** See the header of
 * canvasCardLod for why freezing is the right answer rather than either
 * demoting or continuing to promote.
 */
function useCanvasCardLod({
  referenceIds,
  hotId,
  zoom,
  gestureActive,
  surfaceRef,
}: CanvasCardLodOptions): {
  lod: ReadonlyMap<string, CanvasCardLod>;
  observeCard: (id: string, element: HTMLElement | null) => void;
} {
  const [lod, setLod] = useState<ReadonlyMap<string, CanvasCardLod>>(EMPTY_LOD);
  const [visibleIds, setVisibleIds] = useState<ReadonlySet<string>>(
    () => new Set<string>()
  );
  const [surfaceHidden, setSurfaceHidden] = useState(false);

  const recencyRef = useRef<readonly string[]>([]);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const elementsRef = useRef(new Map<string, HTMLElement>());
  const visibleRef = useRef(visibleIds);
  visibleRef.current = visibleIds;

  const isSurfaceHidden = useCallback(() => {
    const box = surfaceRef.current?.getBoundingClientRect();
    return box === undefined || box.width === 0 || box.height === 0;
  }, [surfaceRef]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (isSurfaceHidden()) return;
        let next: Set<string> | null = null;
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.canvasNodeId;
          if (id === undefined) continue;
          if (entry.isIntersecting === visibleRef.current.has(id)) continue;
          next ??= new Set(visibleRef.current);
          if (entry.isIntersecting) next.add(id);
          else next.delete(id);
        }
        if (next) {
          visibleRef.current = next;
          setVisibleIds(next);
        }
      },
      { root: surface, rootMargin: `${VISIBILITY_MARGIN_PX}px`, threshold: 0 }
    );
    observerRef.current = observer;
    for (const element of elementsRef.current.values())
      observer.observe(element);

    // Fires when the pane is hidden or shown (a `display: none` element reports
    // a zero box), which is the signal an IntersectionObserver cannot give us.
    const resize = new ResizeObserver(() =>
      setSurfaceHidden(isSurfaceHidden())
    );
    resize.observe(surface);
    setSurfaceHidden(isSurfaceHidden());

    return () => {
      observer.disconnect();
      resize.disconnect();
      observerRef.current = null;
    };
  }, [surfaceRef, isSurfaceHidden]);

  const observeCard = useCallback((id: string, element: HTMLElement | null) => {
    const previous = elementsRef.current.get(id);
    if (previous === element) return;
    if (previous) observerRef.current?.unobserve(previous);
    if (element) {
      elementsRef.current.set(id, element);
      observerRef.current?.observe(element);
    } else {
      elementsRef.current.delete(id);
    }
  }, []);

  useEffect(() => {
    const recency = touchCanvasRecency(recencyRef.current, [
      ...(hotId === null ? [] : [hotId]),
      ...referenceIds.filter((id) => visibleIds.has(id)),
    ]);
    recencyRef.current = recency;
    setLod((previous) =>
      computeCanvasCardLod({
        candidateIds: referenceIds,
        visibleIds,
        zoom,
        hotId,
        surfaceHidden,
        gestureActive,
        previous,
        recency,
      })
    );
  }, [referenceIds, visibleIds, zoom, hotId, surfaceHidden, gestureActive]);

  return { lod, observeCard };
}
