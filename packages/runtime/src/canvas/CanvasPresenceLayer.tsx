/**
 * Remote cursors, viewport rectangles, and the participant roster.
 *
 * Everything positional renders inside `<ViewportPortal>`, so the coordinates
 * below are plain canvas coordinates and the whole layer pans and zooms with
 * the board for free. Two consequences worth knowing:
 *
 * **Labels counter-scale, geometry does not.** A viewport rectangle is a real
 * region of the board and must shrink when you zoom out. A name tag is chrome
 * and must stay readable, so it carries `scale(1/zoom)` with a top-left origin
 * that keeps it pinned to the point it names. This is the one place the canvas
 * deliberately fights the transform, and it is safe because nothing here is
 * interactive -- NIM-3845's hazard is pointer-to-content mapping, and the layer
 * is `pointer-events: none` throughout.
 *
 * **An agent has no pointer, so it does not get a fake one.** A session's
 * position on the board is where its work is: the marker sits on the first card
 * of its declared working set, and the halo on those cards is the rest of the
 * signal. Inventing a drifting cursor for a process that has no mouse would
 * look like presence and mean nothing. The protocol still carries optional
 * explicit `cursor` / `viewport` for a session that genuinely does drive a view,
 * and those win when present.
 */
import { useMemo, type CSSProperties, type ReactElement } from 'react';
import { ViewportPortal, useStore } from '@xyflow/react';

import type { CanvasAnyNode } from './CanvasDocument';
import type { CanvasAwarenessPoint } from './canvasBinding';
import type {
  CanvasAgentParticipant,
  CanvasPresenceParticipant,
} from './canvasPresence';

/** Keeps a name tag legible when the board is zoomed out. */
function counterScale(zoom: number): CSSProperties {
  return {
    transform: `scale(${1 / Math.max(zoom, 0.05)})`,
    transformOrigin: 'top left',
  };
}

export interface CanvasPresenceLayerProps {
  participants: readonly CanvasPresenceParticipant[];
  nodes: readonly CanvasAnyNode[];
}

export function CanvasPresenceLayer({
  participants,
  nodes,
}: CanvasPresenceLayerProps): ReactElement | null {
  // Raw scale, not the surface's `canvasZoomBucket` value: that bucket collapses
  // to four numbers for LOD decisions, so a label counter-scaled by it would be
  // wrong everywhere except at 1.0. Subscribing here rather than in the surface
  // keeps the per-frame zoom re-render inside this small subtree instead of
  // rebuilding the board on every wheel tick.
  const zoom = useStore((state) => state.transform[2]);
  const geometry = useMemo(() => {
    const byId = new Map<string, CanvasAnyNode>();
    for (const node of nodes) byId.set(node.id, node);
    return byId;
  }, [nodes]);

  const remote = participants.filter((participant) => !participant.isLocal);
  const localAgents = participants.filter(
    (participant): participant is CanvasAgentParticipant =>
      participant.kind === 'agent' && participant.isLocal
  );
  const marked = [...remote, ...localAgents];
  if (marked.length === 0) return null;

  return (
    <ViewportPortal>
      <div className="canvas-presence" aria-hidden>
        {marked.map((participant) => {
          const anchor = participantAnchor(participant, geometry);
          return (
            <div key={participant.key} className="canvas-presence__participant">
              {participant.viewport && (
                <div
                  className="canvas-presence__viewport"
                  style={{
                    left: participant.viewport.x,
                    top: participant.viewport.y,
                    width: participant.viewport.width,
                    height: participant.viewport.height,
                    borderColor: participant.color,
                  }}
                >
                  <span
                    className="canvas-presence__viewport-label"
                    style={{ ...counterScale(zoom), color: participant.color }}
                  >
                    {participant.name} is looking here
                  </span>
                </div>
              )}

              {anchor && (
                <div
                  className={`canvas-presence__marker canvas-presence__marker--${participant.kind}`}
                  style={{ left: anchor.x, top: anchor.y }}
                >
                  <div style={counterScale(zoom)}>
                    {participant.kind === 'user' ? (
                      <svg
                        className="canvas-presence__cursor"
                        width="18"
                        height="18"
                        viewBox="0 0 18 18"
                      >
                        <path
                          d="M2 1 L2 15 L6 11.5 L8.6 16.6 L11.2 15.3 L8.6 10.4 L14 10.4 Z"
                          fill={participant.color}
                          stroke="var(--nim-bg)"
                          strokeWidth="1"
                        />
                      </svg>
                    ) : (
                      <span
                        className="canvas-presence__agent-dot"
                        style={{ background: participant.color }}
                      />
                    )}
                    <span
                      className="canvas-presence__name"
                      style={{ background: participant.color }}
                    >
                      {participant.name}
                      {participant.kind === 'agent' &&
                        participant.onBehalfOfName !== undefined && (
                          <span className="canvas-presence__on-behalf">
                            for {participant.onBehalfOfName}
                          </span>
                        )}
                    </span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </ViewportPortal>
  );
}

/**
 * Where to draw the participant's marker.
 *
 * A person is at their pointer. A session is at its work: the top-left of the
 * first card it declared, which is also the first card wearing its halo, so the
 * marker and the halo read as one statement rather than two.
 */
function participantAnchor(
  participant: CanvasPresenceParticipant,
  geometry: ReadonlyMap<string, CanvasAnyNode>
): CanvasAwarenessPoint | null {
  if (participant.cursor) return participant.cursor;
  if (participant.kind !== 'agent') return null;
  for (const nodeId of participant.nodeIds) {
    const node = geometry.get(nodeId);
    if (node) return { x: node.x, y: node.y - 26 };
  }
  return null;
}

export interface CanvasPresenceRosterProps {
  participants: readonly CanvasPresenceParticipant[];
  /** Move this user's view to frame the participant's viewport rectangle. */
  onJumpTo(participant: CanvasPresenceParticipant): void;
}

/**
 * "Who else is here", and the cheap half of following someone.
 *
 * Clicking a participant frames their viewport rectangle once. Continuous
 * following -- re-framing on every update they publish -- is the obvious next
 * step and deliberately not here: it takes the viewport away from the user on a
 * cadence they did not ask for, and it needs an exit affordance to be usable.
 * A jump gets most of the value and cannot trap anyone.
 */
export function CanvasPresenceRoster({
  participants,
  onJumpTo,
}: CanvasPresenceRosterProps): ReactElement | null {
  const others = participants.filter(
    (participant) => !(participant.kind === 'user' && participant.isLocal)
  );
  if (others.length === 0) return null;

  return (
    <div className="canvas-presence-roster">
      {others.map((participant) => (
        <button
          key={participant.key}
          type="button"
          className={`canvas-presence-roster__entry canvas-presence-roster__entry--${participant.kind}`}
          style={{ borderColor: participant.color }}
          disabled={participant.viewport === undefined}
          title={
            participant.viewport === undefined
              ? `${participant.name} has not published a view of this board`
              : `Jump to what ${participant.name} is looking at`
          }
          onClick={() => onJumpTo(participant)}
        >
          <span
            className="canvas-presence-roster__swatch"
            style={{ background: participant.color }}
          />
          <span className="canvas-presence-roster__name">
            {participant.name}
          </span>
          {participant.kind === 'agent' && (
            <span className="canvas-presence-roster__badge">session</span>
          )}
        </button>
      ))}
    </div>
  );
}
