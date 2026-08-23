/**
 * The seam between the mockup pin overlay and the host comment platform.
 *
 * Threads live in the canonical `comments` Y.Array, owned by the host's
 * `CollaborationCommentsService`; geometry lives in `mockupPins`, owned by this
 * extension. This module is the only place the two are joined, and it joins
 * them through the shared entity anchor alone -- no selector, offset, or
 * viewport ever reaches the platform.
 *
 * ## Ordering: pin first, thread second, roll the pin back on failure
 *
 * The order is not a preference -- the platform fixes it. `createThread`
 * refuses any anchor the registered adapter does not report `attached`, and it
 * takes the thread's quote from that adapter's `describe`. Both read
 * `mockupPins`. Writing the thread first would therefore fail with
 * ANCHOR_NOT_FOUND every time, because the pin it names would not exist yet.
 *
 * One Y.Doc transaction spanning both writes is not reachable through this
 * API. `service.createThread` is async -- it awaits a capability refresh
 * against the document access source before it writes -- so any transaction
 * opened around the call has already committed by the time the thread lands.
 * Closing that needs a synchronous or transaction-aware entry point on the
 * platform service; it is reported with this slice.
 *
 * Compensation therefore follows canonical state rather than the Promise
 * outcome. A rejected call with no thread rolls the pin back; a call that
 * persisted the thread and only then failed a notification keeps the pin and
 * is treated as committed. Pins left by a process interruption are collected
 * on a later mount by the same author after a conservative grace period.
 */

import type {
  CollaborationCommentsService,
  CollaborativeCommentThread,
} from "@nimbalyst/extension-sdk";
import type { MockupPin } from "../collab/seed";
import { mockupPinAnchor, mockupPinIdFromAnchor } from "./mockupPinAnchor";
import type { MockupPinStore } from "./mockupPinStore";

const INTERRUPTED_CREATION_GRACE_MS = 24 * 60 * 60 * 1000;

/** Everything the overlay knows about a placement before a thread exists. */
export interface MockupPinDraft {
  /** Null for a pin placed on background whitespace. */
  selector: string | null;
  labelSnapshot: string;
  offset: { xPct: number; yPct: number };
  viewport: { width: number; label: string };
}

/** The projection of one comment thread that the overlay renders. */
export interface MockupCommentThread {
  threadId: string;
  pinId: string;
  authorUserId: string;
  authorName: string;
  createdAt: number;
  /** First line of the thread's first comment. */
  preview: string;
  replyCount: number;
  resolved: boolean;
}

export interface MockupCommentViewer {
  userId: string;
  name: string;
}

export interface MockupCommentSource {
  readonly viewer: MockupCommentViewer;
  /**
   * False on a read-only surface (transcript embed, viewer) or when the host
   * reports `comment: false`. Existing threads still render; placement and the
   * composer do not. Read on every call, never cached: access can be revoked
   * mid-session behind an unchanged service object.
   */
  canComment(): boolean;
  getThreads(): readonly MockupCommentThread[];
  subscribe(listener: () => void): () => void;
  /**
   * Place the pin and open its thread. Resolves to the new pin id, or null
   * when the write was refused -- an empty body, no comment capability, or a
   * thread the platform rejected. In every one of those cases no pin survives.
   */
  createThread(draft: MockupPinDraft, body: string): Promise<string | null>;
  /** Pin ids whose thread is resolved; they keep their pin, not their number. */
  getResolvedPinIds(): ReadonlySet<string>;
  /**
   * Reveal the thread behind a pin, and report which thread that is so the
   * caller can select it in the pane it owns. Null when the pin has no thread
   * on this client yet.
   */
  openThread(pinId: string): string | null;
  dispose(): void;
}

export interface MockupCommentSourceOptions {
  service: CollaborationCommentsService;
  pins: MockupPinStore;
  viewer: MockupCommentViewer;
  /**
   * Surface-level gate stacked on top of the host capability -- the read-only
   * viewer and transcript embed can comment on nothing even where the user
   * holds comment access.
   */
  canPlace?: () => boolean;
  /**
   * Whether the `comments` array of this document has finished syncing.
   *
   * This gates the only path here that deletes a pin on inference rather than
   * on evidence, and it must be a real sync fact -- the host's
   * `DocumentSyncProvider.isSynced()`, which is what every other comment
   * mutation path in the app rechecks at mutation time. Connection status is
   * not a substitute: `connected` is set independently of `synced`.
   *
   * Defaults to "not hydrated", which disables interrupted-creation collection
   * entirely. That is deliberate. Leaving a pin the user cannot see costs
   * nothing; deleting a healthy one detaches its thread permanently, for every
   * client. Until a caller wires the real signal, the safe answer is no.
   *
   * The SDK's `CollaborationCommentsService` does not expose hydration today,
   * so no caller can wire this yet -- see the note in `collectDeletedPins`.
   */
  isHydrated?: () => boolean;
  createId?: () => string;
  now?: () => number;
}

function firstLine(body: string): string {
  return body.trim().split(/\r?\n/, 1)[0]?.trim() ?? "";
}

function newId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `pin-${Math.random().toString(36).slice(2, 10)}`;
}

function actorName(thread: CollaborativeCommentThread): string {
  const actor = thread.comments[0]?.actor;
  if (actor?.kind === "agent") return actor.sessionName;
  if (actor?.kind === "user") return actor.displayName;
  return thread.comments[0]?.author ?? "Unknown author";
}

function actorUserId(thread: CollaborativeCommentThread): string {
  const actor = thread.comments[0]?.actor;
  if (actor?.kind === "agent") return actor.onBehalfOfUserId;
  return actor?.userId ?? thread.comments[0]?.author ?? "";
}

/**
 * Project the canonical snapshot down to the threads this mockup owns.
 * Everything else in the array -- top-level comments, text-quote threads
 * written by another editor over the same document -- is left alone.
 */
export function projectMockupThreads(
  service: Pick<CollaborationCommentsService, "getSnapshot">
): MockupCommentThread[] {
  const projected: MockupCommentThread[] = [];
  for (const entry of service.getSnapshot()) {
    if (entry.type !== "thread") continue;
    const pinId = mockupPinIdFromAnchor(entry.anchor);
    if (!pinId) continue;

    const live = entry.comments.filter((comment) => !comment.deleted);
    const root = live[0];
    projected.push({
      threadId: entry.id,
      pinId,
      authorUserId: actorUserId(entry),
      authorName: actorName(entry),
      createdAt: root?.timeStamp ?? 0,
      preview: firstLine(root?.content ?? "") || entry.quote,
      replyCount: Math.max(0, live.length - 1),
      resolved: entry.resolved,
    });
  }
  return projected;
}

export function createMockupCommentSource({
  service,
  pins,
  viewer,
  canPlace = () => true,
  isHydrated = () => false,
  createId = newId,
  now = () => Date.now(),
}: MockupCommentSourceOptions): MockupCommentSource {
  const listeners = new Set<() => void>();
  let cached: readonly MockupCommentThread[] | null = null;

  /**
   * Pins we have seen a thread for. A pin is only ever collected after its
   * thread was observed alive and then observed gone -- so a pin that arrived
   * ahead of its thread over the wire is never mistaken for garbage, and
   * neither is one whose thread simply has not synced to this client yet.
   *
   * That is why the deleted-thread collection below needs no hydration gate of
   * its own: membership here is per-pin proof that this client did receive that
   * thread, so its later absence is a real deletion rather than a chunk that
   * has not landed. The interrupted-creation sweep has no such proof, which is
   * the whole reason it needs one.
   */
  const pinsWithKnownThread = new Set<string>();
  const pendingCreations = new Set<string>();

  /**
   * Collect pins whose thread was deleted; leave pins whose thread was merely
   * resolved. Deletion splices the thread out of the canonical array; resolving
   * only flips a flag, so a resolved thread is still in the snapshot and its
   * pin is still wanted.
   */
  const collectDeletedPins = (threads: readonly MockupCommentThread[]): void => {
    const live = new Set(threads.map((thread) => thread.pinId));
    for (const pinId of pinsWithKnownThread) {
      if (live.has(pinId)) continue;
      pinsWithKnownThread.delete(pinId);
      pins.delete(pinId);
    }
    for (const pinId of live) pinsWithKnownThread.add(pinId);

    // A process can stop after the shared pin write but before the async host
    // call persists its thread. Such a pin is invisible garbage, so it is worth
    // collecting -- but every signal that identifies one is an absence, and an
    // absence is exactly what a half-synced document also looks like.
    //
    // `mockupPins` and `comments` are separate top-level keys in the same
    // Y.Doc, and a document syncs incrementally: there is a window where the
    // pins update has applied and the comments update has not. In that window
    // `live` is empty while the pin map is full, and every same-author pin past
    // the grace period looks interrupted. Read capability does not close that
    // window -- it answers "may this user see comments?", which is true from
    // the first byte. Only a sync fact does, so hydration gates this and the
    // grace period is the backstop behind it.
    //
    // Nothing wires `isHydrated` yet: the SDK's `CollaborationCommentsService`
    // has no hydration member, though the host that builds it already holds
    // `DocumentSyncProvider.isSynced()` internally and gates its own mutations
    // on it. Until that reaches the SDK this collection stays off, which loses
    // nothing but disk.
    if (!isHydrated() || !service.getCapabilities().read) return;

    const collectable = pins
      .snapshot()
      .filter(
        (pin) =>
          pin.createdBy === viewer.userId
          && !live.has(pin.id)
          && !pinsWithKnownThread.has(pin.id)
          && !pendingCreations.has(pin.id)
          && now() - pin.createdAt >= INTERRUPTED_CREATION_GRACE_MS
      )
      .map((pin) => pin.id);
    if (collectable.length === 0) return;

    // Announced before the first delete, never after: a collection interrupted
    // half way through still has to have said what it was about to do. Ids and
    // counts only -- no comment body, quote, or other document content.
    console.warn("[MockupLM] collecting interrupted pin creations", {
      count: collectable.length,
      pinIds: collectable,
    });
    for (const pinId of collectable) pins.delete(pinId);
  };

  /**
   * Pure read. `useSyncExternalStore` calls this during render, so it must
   * never write to the pin store -- collecting a pin mid-render would notify
   * the overlay's other subscription from inside React's render phase.
   */
  const readThreads = (): readonly MockupCommentThread[] => {
    if (!cached) cached = Object.freeze(projectMockupThreads(service));
    return cached;
  };

  /**
   * Re-project and reconcile. Only ever runs from the service subscription or
   * at construction -- never from a render.
   */
  const refresh = (): void => {
    cached = null;
    collectDeletedPins(readThreads());
  };

  const onServiceChanged = (): void => {
    // Eagerly: a deletion arriving from another client must collect its pin
    // whether or not anything is currently rendering threads.
    refresh();
    for (const listener of listeners) listener();
  };

  const unsubscribe = service.subscribe(onServiceChanged);
  refresh();

  return {
    viewer,

    canComment() {
      return service.getCapabilities().comment && canPlace();
    },

    getThreads: readThreads,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async createThread(draft, body) {
      const content = body.trim();
      if (!content) return null;
      if (!service.getCapabilities().comment || !canPlace()) return null;

      const pinId = createId();
      const pin: MockupPin = {
        id: pinId,
        selector: draft.selector,
        labelSnapshot: draft.labelSnapshot,
        offset: { ...draft.offset },
        viewport: { ...draft.viewport },
        createdAt: now(),
        createdBy: viewer.userId,
      };

      // Pin first: the platform resolves the anchor through our adapter before
      // it will write the thread. See the ordering note at the top.
      pins.create(pin);
      pendingCreations.add(pinId);
      try {
        await service.createThread({
          anchor: mockupPinAnchor(pinId, draft.labelSnapshot),
          content,
          clientMutationId: `mockup-pin:${pinId}`,
        });
      } catch (error) {
        const persisted = projectMockupThreads(service).some(
          (thread) => thread.pinId === pinId
        );
        pendingCreations.delete(pinId);
        if (persisted) {
          pinsWithKnownThread.add(pinId);
          cached = null;
          return pinId;
        }
        // The thread truly was refused, so the pin must not survive.
        pins.delete(pinId);
        throw error;
      }

      pendingCreations.delete(pinId);
      pinsWithKnownThread.add(pinId);
      return pinId;
    },

    getResolvedPinIds() {
      return new Set(
        readThreads()
          .filter((thread) => thread.resolved)
          .map((thread) => thread.pinId)
      );
    },

    openThread(pinId) {
      const thread = readThreads().find((candidate) => candidate.pinId === pinId);
      // This is how a pin click reaches the thread list: the panel belongs to
      // the host, which docks it beside this editor and selects the thread the
      // pin stands for. `openPanel` is conditionally present -- a host with no
      // panel surface omits it rather than publishing a silent no-op -- so it
      // is optional-called. Where it is absent the click still highlights the
      // pin and opens its hover card; nothing here may throw.
      service.openPanel?.(
        thread
          ? { threadId: thread.threadId }
          : { anchor: mockupPinAnchor(pinId, "") }
      );
      return thread?.threadId ?? null;
    },

    dispose() {
      unsubscribe();
      listeners.clear();
    },
  };
}
