/**
 * The desktop answer to "how many unresolved comments are inside this card's
 * own document?" -- the second half of the canvas's dual comment count.
 *
 * The board's own threads live in the board's comment room and the canvas
 * derives those itself. This is the *other* conversation: threads written
 * inside a card's document, in that document's room, by people who may never
 * have opened this board. The two are never added together, and this module
 * exists so the card chrome can show them side by side.
 *
 * ## Only rooms somebody else already opened
 *
 * A count is reported for a `doc` card whose room is live -- which is exactly a
 * warm or hot card, because the canvas's connection policy is what opened it.
 * Everything else answers `null`, meaning *unknown*, and the chrome renders
 * unknown as absent. Answering 0 would be a claim this module cannot support:
 * "nobody has commented on that document" is not the same statement as "I have
 * not looked." `peek` is used rather than `acquire` for the same reason -- a
 * comment badge must not open a websocket, and must not keep one alive past the
 * card that owns it.
 *
 * `file` cards answer `null` unconditionally: an unshared local file has no
 * comment room at all, and a shared one is reached through its `sharedAs`
 * binding, which the canvas already resolves to a `doc` reference before the
 * card is rendered.
 *
 * ## Why this polls
 *
 * A room opening is not an event anyone publishes. `CollaborativeEmbedEditor`
 * acquires its provider asynchronously some time after the card mounts, so
 * attaching at mount finds nothing, and there is no "room ready" signal to
 * subscribe to. Once attached, the count is fully live -- it rides the
 * document's own comment repository -- so the poll only ever discovers rooms
 * appearing and disappearing, at the cadence a user opens and closes cards. It
 * is bounded by the board's `doc` cards and stops entirely when there are none.
 */

import { YDocCommentRepository } from '@nimbalyst/runtime/editor/commenting/YDocCommentRepository';
import type { CanvasCardCommentSource, CanvasCardReference } from '@nimbalyst/runtime/canvas';

import {
  collaborativeEmbedProviderCache,
  type CollaborativeEmbedReference,
} from '../../services/CollaborativeEmbedProviderCache';
import { parseCanvasDocumentReference } from './canvasDocumentReference';

/** How often to look for a room that has opened or closed since last time. */
const ROOM_DISCOVERY_INTERVAL_MS = 3000;

interface Attachment {
  repository: YDocCommentRepository;
  unsubscribe: () => void;
  count: number;
}

function referenceKey(reference: CollaborativeEmbedReference): string {
  return `${reference.orgId}\u0000${reference.documentId}`;
}

function canvasReferenceKey(
  reference: CanvasCardReference,
): { key: string; document: CollaborativeEmbedReference } | null {
  if (reference.kind !== 'doc') return null;
  const parsed = parseCanvasDocumentReference(reference.uri);
  if (!parsed) return null;
  return { key: referenceKey(parsed), document: parsed };
}

function countOpenThreads(repository: YDocCommentRepository): number {
  let open = 0;
  for (const entry of repository.getSnapshot()) {
    if (entry.type !== 'thread' || entry.resolved) continue;
    // A thread whose every comment was deleted is a tombstone, not a
    // conversation, and badging it would send a reader looking for nothing.
    if (entry.comments.every((comment) => comment.deleted)) continue;
    open += 1;
  }
  return open;
}

class CanvasCardCommentCounts implements CanvasCardCommentSource {
  private readonly attachments = new Map<string, Attachment>();
  /**
   * Per watcher, not global. Nimbalyst keeps every tab mounted, so two boards
   * are routinely watching at once and a shared "current set" would let the
   * second one open blank every card of the first.
   */
  private readonly watchers = new Map<
    () => void,
    Map<string, CollaborativeEmbedReference>
  >();
  private timer: ReturnType<typeof setInterval> | null = null;

  watch(
    references: readonly CanvasCardReference[],
    onChange: () => void,
  ): () => void {
    this.watchers.set(
      onChange,
      new Map(
        references
          .map(canvasReferenceKey)
          .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
          .map((entry) => [entry.key, entry.document]),
      ),
    );
    this.reconcile();
    this.startPolling();

    return () => {
      this.watchers.delete(onChange);
      this.reconcile();
      if (this.watchers.size === 0) this.stopPolling();
    };
  }

  getOpenThreadCount(reference: CanvasCardReference): number | null {
    const entry = canvasReferenceKey(reference);
    if (!entry) return null;
    return this.attachments.get(entry.key)?.count ?? null;
  }

  /** Test seam: drop everything without waiting for a timer tick. */
  reset(): void {
    this.watchers.clear();
    this.reconcile();
    this.stopPolling();
  }

  /** Every document any mounted board is asking about. */
  private wantedDocuments(): Map<string, CollaborativeEmbedReference> {
    const wanted = new Map<string, CollaborativeEmbedReference>();
    for (const references of this.watchers.values()) {
      for (const [key, document] of references) wanted.set(key, document);
    }
    return wanted;
  }

  private startPolling(): void {
    if (this.timer !== null || this.watchers.size === 0) return;
    this.timer = setInterval(() => {
      this.reconcile();
    }, ROOM_DISCOVERY_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Attach to rooms that appeared, detach from rooms that went away. */
  private reconcile(): void {
    let changed = false;
    const wanted = this.wantedDocuments();

    for (const [key, attachment] of [...this.attachments]) {
      const document = wanted.get(key);
      const live = document
        ? collaborativeEmbedProviderCache.peek(document)
        : null;
      if (live) continue;
      attachment.unsubscribe();
      attachment.repository.destroy();
      this.attachments.delete(key);
      changed = true;
    }

    for (const [key, document] of wanted) {
      if (this.attachments.has(key)) continue;
      const resource = collaborativeEmbedProviderCache.peek(document);
      if (!resource) continue;
      const repository = new YDocCommentRepository(resource.collaboration.yDoc);
      const attachment: Attachment = {
        repository,
        count: countOpenThreads(repository),
        unsubscribe: () => {},
      };
      attachment.unsubscribe = repository.subscribe(() => {
        const next = countOpenThreads(repository);
        if (next === attachment.count) return;
        attachment.count = next;
        this.emit();
      });
      this.attachments.set(key, attachment);
      changed = true;
    }

    if (changed) this.emit();
    if (wanted.size === 0) this.stopPolling();
  }

  private emit(): void {
    for (const listener of this.watchers.keys()) listener();
  }
}

export const canvasCardCommentCounts = new CanvasCardCommentCounts();
