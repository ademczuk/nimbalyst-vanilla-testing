/**
 * The one React Flow node type on the canvas; it dispatches on the card kind.
 *
 * Two invariants live here and both are load-bearing:
 *
 * 1. **A card's content is pointer-inert until the card is activated.** The
 *    body layer sets `pointer-events: none` and only the activated card turns
 *    it back on. Interactive children capture wheel events and fight the pan,
 *    and pointer-to-content mapping is wrong under React Flow's CSS transform
 *    (see NIM-3845). This is what lets a warm card mount a *real* editor at any
 *    zoom: every rendering measurement in that spike was linear in k, and every
 *    failure was in pointer-to-content mapping, which an inert card never
 *    reaches. Activation is gated on scale 1.0 in `toFlowNodes`, so a card that
 *    can take the pointer is never under a transform.
 * 2. **No node is ever silently dropped.** A `file` / `doc` reference and a
 *    node whose `type` is outside JSON Canvas 1.0 both render as a labelled
 *    placeholder that names what it is. The format's openness guarantee is only
 *    real if a foreign card is visible rather than missing.
 */
import {
  Component,
  createContext,
  memo,
  useCallback,
  useContext,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  Handle,
  NodeResizer,
  NodeToolbar,
  Position,
  type NodeProps,
} from '@xyflow/react';

import {
  canvasCardLabel,
  canvasCardReference,
  canvasCardTarget,
  canvasCardText,
  canvasCardUrl,
  sourceHandleId,
  targetHandleId,
  type CanvasCardData,
  type CanvasFlowNode,
} from './canvasFlowMapping';
import { getCanvasCallbacks } from './canvasCallbacks';
import {
  CanvasCardCommentBadges,
  CanvasCardCommentsContext,
} from './CanvasCommentsLayer';
import {
  effectiveCanvasCardReference,
  resolveCanvasCardRevision,
} from './canvasRevisions';
import type { CanvasCardLod } from './canvasCardLod';
import type { CanvasSide } from './CanvasDocument';
import type { CanvasCardClaimant } from './canvasPresence';

/**
 * Callbacks the surface hands its cards.
 *
 * Context rather than node `data` so that moving one card does not change every
 * other card's data identity, and rather than a module singleton so two boards
 * open in two tabs cannot edit each other.
 */
export interface CanvasCardCallbacks {
  /**
   * Registers a reference card's element with the surface's
   * `IntersectionObserver`; `null` unregisters. Only reference cards call it --
   * a sticky note has no LOD to compute.
   */
  observeCard(id: string, element: HTMLElement | null): void;
  /** Use a file reference's `sharedAs` target inside a shared parent canvas. */
  preferSharedReferences: boolean;
  onPatchNode(id: string, patch: Record<string, unknown>): void;
  onReorderNode(id: string, placement: 'front' | 'back'): void;
  onDeleteNode(id: string): void;
}

export const CanvasCardCallbacksContext =
  createContext<CanvasCardCallbacks | null>(null);

/**
 * Who is working on which card.
 *
 * A separate context from the callbacks, and separate from node `data`, for a
 * cost reason: claims change on a presence tick while positions change on a
 * drag frame, and folding them together would rebuild every node object each
 * time a teammate's claim arrived. The surface only publishes a new map when
 * the claim set actually differs (`sameCanvasCardClaimants`), so a board full
 * of cursors moving around costs no card render at all.
 *
 * Read-only by construction. Nothing downstream may consult this to decide
 * whether an edit is permitted -- a claim is an attention declaration, and the
 * moment it gates an edit it has become a lock.
 */
export const CanvasCardClaimsContext = createContext<
  ReadonlyMap<string, readonly CanvasCardClaimant[]>
>(new Map());

/**
 * The board's offer to open a card's history.
 *
 * Null when the host has no `revisions` source, which is what keeps the
 * affordance honest: a "History" button that opens an empty strip in a host
 * that cannot ask the room is a worse answer than no button.
 */
export interface CanvasCardRevisionsAccess {
  /** Reveal this card's revision rail. */
  onOpenRevisions(nodeId: string): void;
}

export const CanvasCardRevisionsContext =
  createContext<CanvasCardRevisionsAccess | null>(null);

/** How many concentric rings a card draws before it starts counting instead. */
const MAX_CLAIM_RINGS = 3;

/**
 * One ring per claimant, outward, with a soft outer glow for agents so a
 * session reads differently from a person at a glance. Painted as box-shadow
 * rather than a border because `.canvas-card` clips its own overflow, and
 * rather than an outline because an outline can only be one colour and two
 * claimants on one card is the normal case, not the edge case.
 */
function claimRings(claimants: readonly CanvasCardClaimant[]): string {
  const layers: string[] = [];
  claimants.slice(0, MAX_CLAIM_RINGS).forEach((claimant, index) => {
    const inner = 1 + index * 3;
    layers.push(`0 0 0 ${inner + 2}px ${claimant.color}`);
    if (claimant.kind === 'agent') {
      layers.push(
        `0 0 0 ${inner + 3}px color-mix(in srgb, ${
          claimant.color
        } 30%, transparent)`
      );
    }
  });
  return layers.join(', ');
}

const HANDLE_SIDES: ReadonlyArray<{ side: CanvasSide; position: Position }> = [
  { side: 'top', position: Position.Top },
  { side: 'right', position: Position.Right },
  { side: 'bottom', position: Position.Bottom },
  { side: 'left', position: Position.Left },
];

/**
 * JSON Canvas colors are either a preset index "1".."6" or a hex string. The
 * presets are named in the spec but their values are left to the app.
 */
const PRESET_COLORS: Record<string, string> = {
  '1': '#e06c75',
  '2': '#d19a66',
  '3': '#e5c07b',
  '4': '#98c379',
  '5': '#56b6c2',
  '6': '#c678dd',
};

export function canvasColorValue(color: unknown): string | null {
  if (typeof color !== 'string' || color.length === 0) return null;
  return PRESET_COLORS[color] ?? (color.startsWith('#') ? color : null);
}

export const CanvasCardNode = memo(function CanvasCardNode({
  id,
  data,
  selected,
}: NodeProps<CanvasFlowNode>) {
  const { node, kind, active, lod, readOnly } = data as CanvasCardData;
  const accent = canvasColorValue(node.color);
  const editable = active && !readOnly;
  const callbacks = useContext(CanvasCardCallbacksContext);
  const claimants = useContext(CanvasCardClaimsContext).get(id);
  const comments = useContext(CanvasCardCommentsContext);
  const commentCounts = comments?.counts.get(id);
  const revisions = useContext(CanvasCardRevisionsContext);
  const pinnedRevision = resolveCanvasCardRevision(canvasCardReference(node));

  const patch = useCallback(
    (fields: Record<string, unknown>) => callbacks?.onPatchNode(id, fields),
    [callbacks, id]
  );

  const observe = useCallback(
    (element: HTMLDivElement | null) => {
      if (kind !== 'reference') return;
      callbacks?.observeCard(id, element);
    },
    [callbacks, id, kind]
  );

  const style: CSSProperties = {
    width: node.width,
    height: node.height,
    ...(accent
      ? ({ '--nim-canvas-card-accent': accent } as CSSProperties)
      : {}),
    ...(claimants && claimants.length > 0
      ? ({ '--nim-canvas-card-rings': claimRings(claimants) } as CSSProperties)
      : {}),
  };

  return (
    <div
      ref={observe}
      className={[
        'canvas-card',
        `canvas-card--${kind}`,
        `canvas-card--lod-${lod}`,
        active ? 'canvas-card--active' : 'canvas-card--inert',
        selected ? 'canvas-card--selected' : '',
        accent ? 'canvas-card--accented' : '',
        claimants && claimants.length > 0 ? 'canvas-card--claimed' : '',
        pinnedRevision.pinned ? 'canvas-card--pinned-revision' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={style}
      data-canvas-node-id={id}
      data-canvas-card-kind={kind}
      data-canvas-card-lod={lod}
      data-canvas-card-revision={pinnedRevision.revisionId ?? undefined}
    >
      <NodeResizer
        isVisible={selected === true && !readOnly && !active}
        minWidth={80}
        minHeight={60}
        lineClassName="canvas-card__resize-line"
        handleClassName="canvas-card__resize-handle"
      />

      <NodeToolbar
        isVisible={selected === true && !active && !readOnly}
        position={Position.Top}
        className="canvas-card-toolbar"
      >
        <button
          type="button"
          className="canvas-card-toolbar__button"
          onClick={() => callbacks?.onReorderNode(id, 'front')}
        >
          Front
        </button>
        <button
          type="button"
          className="canvas-card-toolbar__button"
          onClick={() => callbacks?.onReorderNode(id, 'back')}
        >
          Back
        </button>
        {comments?.canComment === true && (
          <button
            type="button"
            className="canvas-card-toolbar__button"
            onClick={() => comments.onCommentOnCard(id)}
          >
            Comment
          </button>
        )}
        {revisions !== null && kind === 'reference' && (
          <button
            type="button"
            className="canvas-card-toolbar__button"
            onClick={() => revisions.onOpenRevisions(id)}
          >
            History
          </button>
        )}
        <button
          type="button"
          className="canvas-card-toolbar__button canvas-card-toolbar__button--danger"
          onClick={() => callbacks?.onDeleteNode(id)}
        >
          Delete
        </button>
      </NodeToolbar>

      {/* Right, so it never collides with the action toolbar above the card or
          the presence chips below it -- all three can be on screen at once. */}
      {commentCounts !== undefined && (
        <NodeToolbar isVisible position={Position.Right} offset={6}>
          <CanvasCardCommentBadges
            counts={commentCounts}
            onOpen={() => comments?.onOpenCardThread(id)}
          />
        </NodeToolbar>
      )}

      {claimants && claimants.length > 0 && (
        <NodeToolbar
          isVisible
          position={Position.Bottom}
          className="canvas-card-claims"
        >
          {claimants.slice(0, MAX_CLAIM_RINGS).map((claimant) => (
            <span
              key={claimant.key}
              className={`canvas-card-claims__chip canvas-card-claims__chip--${claimant.kind}`}
              style={{ borderColor: claimant.color }}
            >
              <span
                className="canvas-card-claims__swatch"
                style={{ background: claimant.color }}
              />
              {claimant.kind === 'agent'
                ? `${claimant.name} is editing`
                : `${claimant.name} is here`}
              {claimant.onBehalfOfName !== undefined && (
                <span className="canvas-card-claims__on-behalf">
                  for {claimant.onBehalfOfName}
                </span>
              )}
            </span>
          ))}
          {claimants.length > MAX_CLAIM_RINGS && (
            <span className="canvas-card-claims__chip">
              +{claimants.length - MAX_CLAIM_RINGS} more
            </span>
          )}
        </NodeToolbar>
      )}

      {HANDLE_SIDES.map(({ side, position }) => (
        <Handle
          key={`target-${side}`}
          id={targetHandleId(side)}
          type="target"
          position={position}
          className="canvas-card__handle canvas-card__handle--target"
          isConnectable={!readOnly && !active}
        />
      ))}
      {HANDLE_SIDES.map(({ side, position }) => (
        <Handle
          key={`source-${side}`}
          id={sourceHandleId(side)}
          type="source"
          position={position}
          className="canvas-card__handle canvas-card__handle--source"
          isConnectable={!readOnly && !active}
        />
      ))}

      {/* The inert layer. `nodrag` / `nowheel` keep an activated card's own
          scrolling and text selection away from React Flow's pan and zoom. */}
      <div className={`canvas-card__body${editable ? ' nodrag nowheel' : ''}`}>
        <CardBody
          nodeId={id}
          kind={kind}
          node={node}
          lod={lod}
          editable={editable}
          preferSharedReferences={callbacks?.preferSharedReferences === true}
          onPatch={patch}
        />
      </div>
    </div>
  );
});

function CardBody({
  nodeId,
  kind,
  node,
  lod,
  editable,
  preferSharedReferences,
  onPatch,
}: {
  nodeId: string;
  kind: CanvasCardData['kind'];
  node: CanvasCardData['node'];
  lod: CanvasCardLod;
  editable: boolean;
  preferSharedReferences: boolean;
  onPatch: (patch: Record<string, unknown>) => void;
}) {
  switch (kind) {
    case 'sticky':
    case 'text':
      return <TextBody node={node} editable={editable} onPatch={onPatch} />;
    case 'image':
      return <ImageBody node={node} editable={editable} onPatch={onPatch} />;
    case 'group':
      return <FrameBody node={node} editable={editable} onPatch={onPatch} />;
    case 'link':
      return (
        <div className="canvas-card__link select-text">
          <span className="canvas-card__link-url">{canvasCardUrl(node)}</span>
        </div>
      );
    case 'reference':
      return (
        <ReferenceBody
          nodeId={nodeId}
          node={node}
          lod={lod}
          preferSharedReference={preferSharedReferences}
        />
      );
    case 'unsupported':
    default:
      return (
        <Placeholder
          title={canvasCardLabel(node) || node.id}
          detail={`type: ${node.type}`}
          note="Unsupported card type. Its data is preserved when this board is saved."
        />
      );
  }
}

function TextBody({
  node,
  editable,
  onPatch,
}: {
  node: CanvasCardData['node'];
  editable: boolean;
  onPatch: (patch: Record<string, unknown>) => void;
}) {
  const text = canvasCardText(node);
  if (editable) {
    return (
      <textarea
        className="canvas-card__text-input"
        value={text}
        autoFocus
        spellCheck
        placeholder="Write something"
        onChange={(event) => onPatch({ text: event.target.value })}
      />
    );
  }
  return (
    <div className="canvas-card__text select-text">
      {text || <span className="canvas-card__placeholder-text">Empty</span>}
    </div>
  );
}

function ImageBody({
  node,
  editable,
  onPatch,
}: {
  node: CanvasCardData['node'];
  editable: boolean;
  onPatch: (patch: Record<string, unknown>) => void;
}) {
  const url = canvasCardUrl(node);
  if (url) {
    return (
      <img
        className="canvas-card__image"
        src={url}
        alt={canvasCardLabel(node) || 'Canvas image'}
        draggable={false}
      />
    );
  }
  if (editable) {
    return (
      <input
        className="canvas-card__url-input"
        type="url"
        autoFocus
        placeholder="Image URL"
        defaultValue=""
        onBlur={(event) => onPatch({ url: event.target.value.trim() })}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            onPatch({ url: event.currentTarget.value.trim() });
          }
        }}
      />
    );
  }
  return (
    <div className="canvas-card__placeholder-text canvas-card__image-empty">
      Click to add an image URL
    </div>
  );
}

function FrameBody({
  node,
  editable,
  onPatch,
}: {
  node: CanvasCardData['node'];
  editable: boolean;
  onPatch: (patch: Record<string, unknown>) => void;
}) {
  const label = canvasCardLabel(node);
  return (
    <div className="canvas-card__frame">
      {editable ? (
        <input
          className="canvas-card__frame-input"
          type="text"
          autoFocus
          value={label}
          placeholder="Frame"
          onChange={(event) => onPatch({ label: event.target.value })}
        />
      ) : (
        <span className="canvas-card__frame-label select-text">{label}</span>
      )}
    </div>
  );
}

/**
 * A card that references real content: a workspace file, or a shared document.
 *
 * Cold is drawn here, from data the board already has. Warm and hot go through
 * the host's `renderCard` slot -- the canvas never learns how to resolve an
 * extension or open a room, and the same component tree runs in the web console
 * against a completely different resolver.
 *
 * The mount is *not* keyed on `detail`. Warm and hot differ by a prop so that
 * clicking into a card gives you the editor you were already looking at, rather
 * than tearing down its state, its scroll position, and its collab room to build
 * an identical one.
 */
function ReferenceBody({
  nodeId,
  node,
  lod,
  preferSharedReference,
}: {
  nodeId: string;
  node: CanvasCardData['node'];
  lod: CanvasCardLod;
  preferSharedReference: boolean;
}) {
  const localReference = canvasCardReference(node);
  const reference = effectiveCanvasCardReference(localReference, {
    preferShared: preferSharedReference,
  });
  const pinned = resolveCanvasCardRevision(reference).pinned;
  const label = canvasCardLabel(node) || canvasCardTarget(node);
  const RenderCard = getCanvasCallbacks().renderCard;

  if (lod === 'cold' || !reference || !RenderCard) {
    return (
      <ColdCard
        title={label}
        detail={canvasCardTarget(node)}
        note={
          !reference
            ? 'This card has no resolvable target.'
            : RenderCard
            ? undefined
            : 'No card renderer is registered in this host.'
        }
      />
    );
  }

  // A pinned card is history and never mounts hot, whatever the viewport says.
  // The editor a host mounts for `hot` writes to the live document, so a
  // revision card that could go hot would let an edit aimed at "v3" land on
  // head -- the one way this feature could destroy something.
  const detail = pinned ? 'warm' : lod;

  return (
    <CanvasCardBoundary label={label}>
      <RenderCard
        nodeId={nodeId}
        reference={reference}
        label={label}
        detail={detail}
      />
    </CanvasCardBoundary>
  );
}

/**
 * The cold state: a cheap DOM summary, not a raster.
 *
 * The plan allows either. A raster would mean capturing the live mount with
 * html2canvas on the way down to cold -- a full synchronous clone-and-paint of
 * third-party DOM, on the exact frame the board is already busy unmounting
 * editors, to produce an image of something the user just zoomed away from. The
 * summary costs one div, always renders, and is legible at zooms where a
 * screenshot of 13px text would not be. Revisit if a card type ever has content
 * that a title cannot stand in for.
 */
function ColdCard({
  title,
  detail,
  note,
}: {
  title: string;
  detail: string;
  note?: string;
}) {
  return (
    <div className="canvas-card__cold select-text">
      <div className="canvas-card__cold-title">{title || detail}</div>
      <div className="canvas-card__cold-detail">{detail}</div>
      {note !== undefined && (
        <div className="canvas-card__cold-note">{note}</div>
      )}
    </div>
  );
}

/**
 * A card is arbitrary third-party React. One throwing must cost the user that
 * card, not the board they had it on.
 */
class CanvasCardBoundary extends Component<
  { label: string; children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(
      '[CanvasCard] card renderer crashed:',
      this.props.label,
      error
    );
  }

  render() {
    if (this.state.error) {
      return (
        <ColdCard
          title={this.props.label}
          detail={this.state.error.message}
          note="This card failed to render. The board and its other cards are unaffected."
        />
      );
    }
    return this.props.children;
  }
}

function Placeholder({
  title,
  detail,
  note,
}: {
  title: string;
  detail: string;
  note: string;
}) {
  return (
    <div className="canvas-card__placeholder select-text">
      <div className="canvas-card__placeholder-title">{title}</div>
      <div className="canvas-card__placeholder-detail">{detail}</div>
      <div className="canvas-card__placeholder-note">{note}</div>
    </div>
  );
}
