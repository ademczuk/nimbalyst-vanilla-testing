/**
 * Canvas presence: who is on the board, and which cards they are working on.
 *
 * Everything here is pure. It takes awareness entries (or working-set events)
 * and returns what to draw; it never reads the DOM, never touches a Y.Map, and
 * never decides whether an edit is allowed. That last one is the whole design:
 *
 * **A working-set claim is an attention declaration, not a lock.** It says "this
 * session is editing these cards right now" so a busy board stays legible. It
 * grants nothing and blocks nothing. If a code path ever consults a claim to
 * decide whether a human may type, that is a lock and it is the wrong thing --
 * the point of publishing attention is that people can see each other coming,
 * not that they are kept out.
 *
 * **The agent is a participant, not a mode.** Its actor shape mirrors
 * `CollaborativeAgentCommentActor` from the comment protocol -- `sessionId`,
 * `sessionName`, `onBehalfOfUserId` -- because an agent in Nimbalyst is a
 * session that belongs to a person, not an anonymous guest reaching in over a
 * socket. Slice 5 anchors comment threads with the same actor, and the two must
 * agree or one board shows two different notions of "the agent".
 *
 * **Expiry is structural, not timed.** An agent rides inside the awareness
 * entry of the client that hosts its session, so it is present exactly as long
 * as that client is. A crashed peer's entry is dropped by awareness and every
 * claim it carried disappears with it -- there is no heartbeat to miss and no
 * sweep to schedule. Locally the same thing is expressed as a `disconnect`
 * event when the session reaches a terminal state, so a session that dies
 * without releasing does not leave a card haloed forever. Both paths funnel
 * through `applyCanvasWorkingSetEvent`, which is why that reducer is where the
 * tests live.
 */
import type {
  CanvasAwarenessEntry,
  CanvasAwarenessPoint,
  CanvasAwarenessViewportRect,
} from './canvasBinding';

/**
 * One agent session's presence, carried inside its host client's awareness
 * entry. Mirrors `CollaborativeAgentCommentActor`; `nodeIds` is the addition.
 */
export interface CanvasAgentPresence {
  sessionId: string;
  sessionName: string;
  /** The human the session acts for. Presence should show this, not hide it. */
  onBehalfOfUserId?: string;
  onBehalfOfDisplayName?: string;
  /** The declared working set: card ids this session is editing right now. */
  nodeIds: readonly string[];
  /** Optional explicit position; otherwise derived from the claimed cards. */
  cursor?: CanvasAwarenessPoint;
  viewport?: CanvasAwarenessViewportRect;
}

interface CanvasParticipantBase {
  /** Stable across renders; unique per participant, agents included. */
  key: string;
  clientId: number;
  name: string;
  color: string;
  /** True for this client's own entry, and for agents it hosts. */
  isLocal: boolean;
  cursor?: CanvasAwarenessPoint;
  viewport?: CanvasAwarenessViewportRect;
}

export interface CanvasUserParticipant extends CanvasParticipantBase {
  kind: 'user';
  userId?: string;
  /** The single card this person has selected, if exactly one. */
  focusedNodeId?: string;
}

export interface CanvasAgentParticipant extends CanvasParticipantBase {
  kind: 'agent';
  sessionId: string;
  onBehalfOfUserId?: string;
  onBehalfOfName?: string;
  nodeIds: readonly string[];
}

export type CanvasPresenceParticipant =
  | CanvasUserParticipant
  | CanvasAgentParticipant;

/** One claimant of one card. Cards routinely have more than one. */
export interface CanvasCardClaimant {
  key: string;
  kind: 'user' | 'agent';
  name: string;
  color: string;
  isLocal: boolean;
  onBehalfOfName?: string;
}

/**
 * Agent colours. Humans bring their own from the collab host; a session has no
 * profile colour to inherit, so it gets a deterministic one from its id and a
 * distinct visual treatment (see `.canvas-presence--agent`). Deliberately not
 * the hosting human's colour: two sessions running for the same person have to
 * be tellable apart on a card that both are editing.
 */
const AGENT_COLORS: readonly string[] = [
  '#7c8cff',
  '#3fb6a8',
  '#c98cf1',
  '#e8a33d',
  '#4aa3e0',
  '#d96a8f',
];

const FALLBACK_USER_COLOR = '#8b8b8b';

export function canvasAgentColor(sessionId: string): string {
  let hash = 0;
  for (let index = 0; index < sessionId.length; index += 1) {
    hash = (hash * 31 + sessionId.charCodeAt(index)) | 0;
  }
  return AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length];
}

export interface CanvasPresenceOptions {
  /** This client's awareness id, so we never draw a cursor for ourselves. */
  localClientId?: number;
}

/**
 * Flatten awareness entries into the participants to draw.
 *
 * The local client contributes itself (for the roster, without a cursor -- you
 * already know where your pointer is) and every agent session it hosts, because
 * an agent working your board in your app is exactly the thing you most want to
 * see. Remote entries contribute their human and their agents alike.
 */
export function canvasPresenceParticipants(
  entries: ReadonlyMap<number, CanvasAwarenessEntry>,
  options: CanvasPresenceOptions = {}
): readonly CanvasPresenceParticipant[] {
  const participants: CanvasPresenceParticipant[] = [];
  const clientIds = [...entries.keys()].sort((left, right) => left - right);

  for (const clientId of clientIds) {
    const entry = entries.get(clientId);
    if (!entry) continue;
    const isLocal = clientId === options.localClientId;
    const color = entry.user?.color ?? FALLBACK_USER_COLOR;

    participants.push({
      kind: 'user',
      key: `client:${clientId}`,
      clientId,
      name: entry.user?.name ?? 'Someone',
      color,
      isLocal,
      ...(entry.user?.id === undefined ? {} : { userId: entry.user.id }),
      // Your own pointer and viewport are not news to you.
      ...(isLocal || !entry.cursor ? {} : { cursor: entry.cursor }),
      ...(isLocal || !entry.viewport ? {} : { viewport: entry.viewport }),
      ...(entry.selectedNodeId === undefined
        ? {}
        : { focusedNodeId: entry.selectedNodeId }),
    });

    for (const agent of entry.agents ?? []) {
      participants.push({
        kind: 'agent',
        key: `client:${clientId}:session:${agent.sessionId}`,
        clientId,
        sessionId: agent.sessionId,
        name: agent.sessionName,
        color: canvasAgentColor(agent.sessionId),
        isLocal,
        nodeIds: agent.nodeIds,
        // A session is hosted by exactly one client, and that client's
        // awareness `user` block is the human it is acting for. So the
        // on-behalf-of identity does not have to be plumbed through the
        // declaration at all -- it is already on the entry carrying the claim,
        // which is also the only place it could be verified. An explicit value
        // still wins, for a host that has a better answer.
        ...(agent.onBehalfOfUserId ?? entry.user?.id
          ? { onBehalfOfUserId: agent.onBehalfOfUserId ?? entry.user?.id }
          : {}),
        ...(agent.onBehalfOfDisplayName ?? entry.user?.name
          ? {
              onBehalfOfName: agent.onBehalfOfDisplayName ?? entry.user?.name,
            }
          : {}),
        ...(agent.cursor ? { cursor: agent.cursor } : {}),
        ...(agent.viewport ? { viewport: agent.viewport } : {}),
      });
    }
  }
  return participants;
}

/**
 * Per-card claimants, agents first.
 *
 * A human's claim is the card they have selected, which is the same signal the
 * plan calls "a card-level highlight when someone has a card focused" -- one
 * mechanism rather than two, so an agent and a person on the same card compose
 * instead of fighting for the same border. Your own selection is left out:
 * React Flow already draws it, and a halo on the card you are working in is
 * noise.
 */
export function canvasCardClaimants(
  participants: readonly CanvasPresenceParticipant[]
): ReadonlyMap<string, readonly CanvasCardClaimant[]> {
  const claims = new Map<string, CanvasCardClaimant[]>();

  const add = (nodeId: string, claimant: CanvasCardClaimant): void => {
    const existing = claims.get(nodeId);
    if (existing) existing.push(claimant);
    else claims.set(nodeId, [claimant]);
  };

  for (const participant of participants) {
    if (participant.kind !== 'agent') continue;
    for (const nodeId of participant.nodeIds) {
      add(nodeId, {
        key: participant.key,
        kind: 'agent',
        name: participant.name,
        color: participant.color,
        isLocal: participant.isLocal,
        ...(participant.onBehalfOfName === undefined
          ? {}
          : { onBehalfOfName: participant.onBehalfOfName }),
      });
    }
  }

  for (const participant of participants) {
    if (participant.kind !== 'user') continue;
    if (participant.isLocal || participant.focusedNodeId === undefined)
      continue;
    add(participant.focusedNodeId, {
      key: participant.key,
      kind: 'user',
      name: participant.name,
      color: participant.color,
      isLocal: false,
    });
  }

  return claims;
}

/** Structural equality, so an unchanged claim set costs the board no render. */
export function sameCanvasCardClaimants(
  left: ReadonlyMap<string, readonly CanvasCardClaimant[]>,
  right: ReadonlyMap<string, readonly CanvasCardClaimant[]>
): boolean {
  if (left === right) return true;
  if (left.size !== right.size) return false;
  for (const [nodeId, leftClaimants] of left) {
    const rightClaimants = right.get(nodeId);
    if (!rightClaimants || rightClaimants.length !== leftClaimants.length) {
      return false;
    }
    for (let index = 0; index < leftClaimants.length; index += 1) {
      const a = leftClaimants[index];
      const b = rightClaimants[index];
      if (
        a.key !== b.key ||
        a.kind !== b.kind ||
        a.name !== b.name ||
        a.color !== b.color ||
        a.isLocal !== b.isLocal ||
        a.onBehalfOfName !== b.onBehalfOfName
      ) {
        return false;
      }
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// The local working-set registry: declare / release / disconnect.
// ---------------------------------------------------------------------------

export interface CanvasWorkingSetDeclaration {
  sessionId: string;
  sessionName: string;
  onBehalfOfUserId?: string;
  onBehalfOfDisplayName?: string;
  /** The board, as the host names it: a file path or a `collab://` URI. */
  boardKey: string;
  nodeIds: readonly string[];
}

export type CanvasWorkingSetEvent =
  | { type: 'declare'; declaration: CanvasWorkingSetDeclaration }
  | {
      type: 'release';
      sessionId: string;
      /** Omitted releases every board this session holds. */
      boardKey?: string;
      /** Omitted releases the whole claim on the named board. */
      nodeIds?: readonly string[];
    }
  /**
   * The session is gone -- ended, errored, interrupted, or its host went away.
   * Everything it held is released. This is the branch that guarantees a
   * crashed session cannot leave a card haloed forever.
   */
  | { type: 'disconnect'; sessionId: string };

/** boardKey -> sessionId -> presence. */
export type CanvasWorkingSetState = ReadonlyMap<
  string,
  ReadonlyMap<string, CanvasAgentPresence>
>;

export const EMPTY_CANVAS_WORKING_SET: CanvasWorkingSetState = new Map();

/**
 * The claim state machine.
 *
 * Returns the *same* state object when nothing changed, so a redundant declare
 * or a release for a session that holds nothing does not wake every subscriber.
 */
export function applyCanvasWorkingSetEvent(
  state: CanvasWorkingSetState,
  event: CanvasWorkingSetEvent
): CanvasWorkingSetState {
  switch (event.type) {
    case 'declare': {
      const { declaration } = event;
      const nodeIds = dedupe(declaration.nodeIds);
      if (declaration.sessionId === '' || declaration.boardKey === '') {
        return state;
      }
      // Declaring nothing is a release. It is the same statement.
      if (nodeIds.length === 0) {
        return applyCanvasWorkingSetEvent(state, {
          type: 'release',
          sessionId: declaration.sessionId,
          boardKey: declaration.boardKey,
        });
      }
      const presence: CanvasAgentPresence = {
        sessionId: declaration.sessionId,
        sessionName: declaration.sessionName,
        nodeIds,
        ...(declaration.onBehalfOfUserId === undefined
          ? {}
          : { onBehalfOfUserId: declaration.onBehalfOfUserId }),
        ...(declaration.onBehalfOfDisplayName === undefined
          ? {}
          : { onBehalfOfDisplayName: declaration.onBehalfOfDisplayName }),
      };
      const board = state.get(declaration.boardKey);
      if (board && samePresence(board.get(declaration.sessionId), presence)) {
        return state;
      }
      // A session works one board at a time; declaring on a second board
      // releases the first, which is what "this is what I am doing now" means.
      const cleared = applyCanvasWorkingSetEvent(state, {
        type: 'release',
        sessionId: declaration.sessionId,
      });
      const next = new Map(cleared);
      const nextBoard = new Map(next.get(declaration.boardKey) ?? []);
      nextBoard.set(declaration.sessionId, presence);
      next.set(declaration.boardKey, nextBoard);
      return next;
    }

    case 'release': {
      const releasedIds =
        event.nodeIds === undefined ? null : new Set(event.nodeIds);
      let next: Map<string, ReadonlyMap<string, CanvasAgentPresence>> | null =
        null;
      for (const [boardKey, board] of state) {
        if (event.boardKey !== undefined && event.boardKey !== boardKey) {
          continue;
        }
        const held = board.get(event.sessionId);
        if (!held) continue;

        const remaining =
          releasedIds === null
            ? []
            : held.nodeIds.filter((id) => !releasedIds.has(id));
        if (remaining.length === held.nodeIds.length) continue;

        next ??= new Map(state);
        const nextBoard = new Map(board);
        if (remaining.length === 0) nextBoard.delete(event.sessionId);
        else nextBoard.set(event.sessionId, { ...held, nodeIds: remaining });
        if (nextBoard.size === 0) next.delete(boardKey);
        else next.set(boardKey, nextBoard);
      }
      return next ?? state;
    }

    case 'disconnect':
      return applyCanvasWorkingSetEvent(state, {
        type: 'release',
        sessionId: event.sessionId,
      });

    default:
      return state;
  }
}

/** Agents to publish for one board, ordered so the payload is stable. */
export function canvasWorkingSetForBoard(
  state: CanvasWorkingSetState,
  boardKey: string
): readonly CanvasAgentPresence[] {
  const board = state.get(boardKey);
  if (!board || board.size === 0) return EMPTY_AGENTS;
  return [...board.values()].sort((left, right) =>
    left.sessionId < right.sessionId
      ? -1
      : left.sessionId > right.sessionId
      ? 1
      : 0
  );
}

const EMPTY_AGENTS: readonly CanvasAgentPresence[] = [];

function dedupe(nodeIds: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const nodeId of nodeIds) {
    if (typeof nodeId !== 'string' || nodeId.length === 0) continue;
    if (seen.has(nodeId)) continue;
    seen.add(nodeId);
    result.push(nodeId);
  }
  return result;
}

function samePresence(
  left: CanvasAgentPresence | undefined,
  right: CanvasAgentPresence
): boolean {
  return (
    left !== undefined &&
    left.sessionId === right.sessionId &&
    left.sessionName === right.sessionName &&
    left.onBehalfOfUserId === right.onBehalfOfUserId &&
    left.onBehalfOfDisplayName === right.onBehalfOfDisplayName &&
    left.nodeIds.length === right.nodeIds.length &&
    left.nodeIds.every((id, index) => id === right.nodeIds[index])
  );
}

/**
 * The host-facing handle on that state.
 *
 * A module singleton for the same reason `setCanvasCallbacks` is one: the
 * declaration arrives from outside React (an MCP tool call crossing IPC) and
 * has to find whichever board component is mounted, or none at all. A claim for
 * a board nobody has open is held, not dropped, and publishes the moment that
 * board opens -- so the tool does not fail just because the user is looking
 * somewhere else.
 */
export class CanvasWorkingSetRegistry {
  private state: CanvasWorkingSetState = EMPTY_CANVAS_WORKING_SET;
  private readonly listeners = new Map<string, Set<() => void>>();
  // `useSyncExternalStore` compares snapshots by identity and loops forever on
  // a getter that allocates, so a board's array is built once per change.
  private readonly snapshots = new Map<
    string,
    readonly CanvasAgentPresence[]
  >();

  apply(event: CanvasWorkingSetEvent): CanvasWorkingSetState {
    const previous = this.state;
    const next = applyCanvasWorkingSetEvent(previous, event);
    if (next === previous) return previous;
    this.state = next;
    const touched = new Set([...previous.keys(), ...next.keys()]);
    for (const boardKey of touched) {
      if (previous.get(boardKey) === next.get(boardKey)) continue;
      this.snapshots.delete(boardKey);
      const listeners = this.listeners.get(boardKey);
      if (!listeners) continue;
      for (const listener of listeners) listener();
    }
    return next;
  }

  getState(): CanvasWorkingSetState {
    return this.state;
  }

  getBoard(boardKey: string): readonly CanvasAgentPresence[] {
    const cached = this.snapshots.get(boardKey);
    if (cached) return cached;
    const snapshot = canvasWorkingSetForBoard(this.state, boardKey);
    this.snapshots.set(boardKey, snapshot);
    return snapshot;
  }

  /** True when a board component is mounted on this key and will publish. */
  hasSubscribers(boardKey: string): boolean {
    return (this.listeners.get(boardKey)?.size ?? 0) > 0;
  }

  subscribe(boardKey: string, listener: () => void): () => void {
    const existing = this.listeners.get(boardKey);
    const listeners = existing ?? new Set<() => void>();
    if (!existing) this.listeners.set(boardKey, listeners);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(boardKey);
    };
  }
}

export const canvasWorkingSetRegistry = new CanvasWorkingSetRegistry();
