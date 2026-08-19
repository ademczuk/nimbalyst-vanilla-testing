/**
 * Pure helpers for DatamodelLM collaboration presence.
 *
 * Deliberately free of Yjs/DOM dependencies so they can be unit-tested
 * directly. The binding already PUBLISHES `selectedEntityId` /
 * `selectedRelationshipId` (see `datamodelBinding.handleStoreChange`); these
 * helpers are the consuming half -- they reduce raw awareness states into a
 * render-ready list, and index that list by the entity / relationship it
 * points at so the canvas can look up presence per node in O(1).
 *
 * Unlike the CSV overlay, nothing here does coordinate math: React Flow
 * already positions the node, so presence renders as chrome on the node
 * itself.
 */

/** One remote collaborator's selection, ready for rendering. */
export interface RemotePresence {
  /** y-protocols client id. Unique per tab; use it as a React key. */
  clientId: number;
  /** Stable cross-tab user id. Two tabs of one user share this. */
  userId: string;
  name: string;
  color: string;
  selectedEntityId: string | null;
  selectedRelationshipId: string | null;
}

/**
 * Shape of a single awareness state as written by `DataModelBinding`. Kept
 * loose because awareness states are opaque `Record<string, unknown>` on the
 * wire.
 */
interface RawAwarenessState {
  user?: { id?: unknown; name?: unknown; color?: unknown };
  selectedEntityId?: unknown;
  selectedRelationshipId?: unknown;
}

function toId(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

/**
 * Reduce raw awareness states into a render-ready presence list.
 *
 * - Skips the local client (`localClientId`).
 * - Skips states without a usable `user.id`.
 * - Skips collaborators who have nothing selected -- there is nothing to draw.
 *
 * Fail-soft: a malformed collaborator is dropped, never thrown. This is
 * presence chrome, not document data.
 */
export function extractRemotePresences(
  states: Map<number, RawAwarenessState>,
  localClientId: number,
): RemotePresence[] {
  const out: RemotePresence[] = [];
  for (const [clientId, state] of states) {
    if (clientId === localClientId) continue;
    if (!state || typeof state !== 'object') continue;

    const user = state.user;
    const userId = user ? toId(user.id) : null;
    if (!userId) continue;

    const selectedEntityId = toId(state.selectedEntityId);
    const selectedRelationshipId = toId(state.selectedRelationshipId);
    if (!selectedEntityId && !selectedRelationshipId) continue;

    const name =
      user && typeof user.name === 'string' && user.name.trim() ? user.name : 'Collaborator';
    const color = user && typeof user.color === 'string' && user.color ? user.color : '#888888';

    out.push({ clientId, userId, name, color, selectedEntityId, selectedRelationshipId });
  }
  return out;
}

/** Presence lists keyed by the entity / relationship id they point at. */
export interface PresenceIndex {
  entities: Map<string, RemotePresence[]>;
  relationships: Map<string, RemotePresence[]>;
}

function push(index: Map<string, RemotePresence[]>, key: string, presence: RemotePresence): void {
  const existing = index.get(key);
  if (!existing) {
    index.set(key, [presence]);
    return;
  }
  // One user with two tabs on the same entity is one collaborator, not two
  // chips. Keep the first (lowest clientId wins by iteration order).
  if (existing.some((p) => p.userId === presence.userId)) return;
  existing.push(presence);
}

/** Bucket presences by target so the canvas can look each node up directly. */
export function indexPresences(presences: RemotePresence[]): PresenceIndex {
  const entities = new Map<string, RemotePresence[]>();
  const relationships = new Map<string, RemotePresence[]>();
  for (const presence of presences) {
    if (presence.selectedEntityId) push(entities, presence.selectedEntityId, presence);
    if (presence.selectedRelationshipId) {
      push(relationships, presence.selectedRelationshipId, presence);
    }
  }
  return { entities, relationships };
}
