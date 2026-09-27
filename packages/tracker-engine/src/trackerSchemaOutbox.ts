/**
 * The push side of the schema lane: offer every locally-changed schema row to
 * the room.
 *
 * Runs at the end of every bootstrap and, since NIM-6654, whenever the host
 * reports a schema save while connected. Before that the only trigger was the
 * bootstrap, so an edit made mid-session sat at `pending` until the socket
 * happened to drop.
 *
 * Two runs can overlap -- a save lands while the post-bootstrap drain is still
 * awaiting `listUnsynced` -- and a row stays in the host's outbox until its ack
 * is applied. So the outbox remembers what it has sent and not yet heard back
 * about, and does not send the same content for the same type twice. Changed
 * content for a type already in flight is sent: the room orders the two by
 * arrival, and the later one is the one the author meant.
 */

import type { TrackerClientMessage } from './trackerProtocol.js';
import type { TrackerSchemaSyncHooks } from './TrackerSyncEngine.js';

export interface TrackerSchemaOutboxDeps {
  hooks: () => TrackerSchemaSyncHooks | undefined;
  isOpen: () => boolean;
  send: (message: TrackerClientMessage) => void;
  newMutationId: () => string;
  /** The engine's cmid -> lane id map, which rejection acks are resolved through. */
  pendingLaneIds: Map<string, string>;
}

export class TrackerSchemaOutbox {
  /** clientMutationId -> the type and payload that mutation carried. */
  private readonly inFlight = new Map<string, { type: string; model: string | null }>();
  private running: Promise<void> | null = null;
  private rerun = false;

  constructor(private readonly deps: TrackerSchemaOutboxDeps) {}

  /** Push what the host has queued. Concurrent calls coalesce into one follow-up run. */
  push(): Promise<void> {
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.rerun = false;
          await this.pushOnce();
        } while (this.rerun);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  /** The room answered this mutation, either way. */
  settle(clientMutationId: string): void {
    this.inFlight.delete(clientMutationId);
  }

  /** A new socket means nothing sent on the old one will be acked. */
  reset(): void {
    this.inFlight.clear();
  }

  private isInFlight(type: string, model: string | null): boolean {
    for (const sent of this.inFlight.values()) {
      if (sent.type === type && sent.model === model) return true;
    }
    return false;
  }

  private async pushOnce(): Promise<void> {
    const hooks = this.deps.hooks();
    if (!hooks || !this.deps.isOpen()) return;

    const pending = await hooks.listUnsynced();
    if (!this.deps.isOpen()) return;
    const toSend = pending
      .map(def => ({ type: def.type, model: def.deleted ? null : def.model }))
      .filter(def => !this.isInFlight(def.type, def.model));
    if (toSend.length > 0) {
      console.info(`[TrackerSchemaSync] pushing ${toSend.length} unsynced schema mutation(s)`);
    }
    for (const def of toSend) {
      const clientMutationId = this.deps.newMutationId();
      this.deps.pendingLaneIds.set(clientMutationId, def.type);
      this.inFlight.set(clientMutationId, def);
      // The model JSON travels as plaintext; the server encrypts it at rest
      // with the team DEK. A null payload is a tombstone.
      console.info(
        `[TrackerSchemaSync] -> mutation (${def.model === null ? 'delete' : 'upsert'}) type=${def.type} cmid=${clientMutationId}`,
      );
      this.deps.send({
        type: 'trackerSchemaMutation',
        clientMutationId,
        schemaType: def.type,
        encryptedPayload: def.model,
      });
    }
  }
}
