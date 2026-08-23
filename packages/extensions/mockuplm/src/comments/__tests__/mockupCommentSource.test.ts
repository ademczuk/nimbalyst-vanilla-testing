// @vitest-environment node
/**
 * The join between the host comment platform and the extension's pin map.
 *
 * The fake service below reproduces the two platform behaviors that actually
 * constrain this code: `createThread` refuses an anchor no registered adapter
 * reports `attached`, and deleting a thread splices it out of the snapshot
 * while resolving one only flips a flag. A fake without the anchor gate would
 * happily pass a wrong write order.
 */

import { describe, expect, it, vi } from "vitest";
import type {
  CollaborationCommentsService,
  CollaborativeCommentsSnapshot,
  CollaborativeCommentThread,
  CommentCapabilities,
  MountedCommentAnchorAdapter,
} from "@nimbalyst/extension-sdk";
import { createMockupCommentSource } from "../mockupCommentSource";
import { createMockupPinAnchorAdapter, mockupPinAnchor } from "../mockupPinAnchor";
import { createInMemoryMockupPinStore, type MockupPinStore } from "../mockupPinStore";

const DRAFT = {
  selector: "#save",
  labelSnapshot: "button:Save changes",
  offset: { xPct: 0.5, yPct: 0.5 },
  viewport: { width: 1440, label: "Desktop" },
};

const VIEWER = { userId: "user-1", name: "Ada" };

const GRACE_MS = 24 * 60 * 60 * 1000;

function createFakeService(
  capabilities: CommentCapabilities = { read: true, comment: true },
  openPanel?: (input?: { threadId?: string }) => void
) {
  let entries: CollaborativeCommentThread[] = [];
  const listeners = new Set<() => void>();
  const adapters = new Set<MountedCommentAnchorAdapter>();
  let snapshot: CollaborativeCommentsSnapshot = Object.freeze([]);
  let sequence = 0;

  const publish = (): void => {
    snapshot = Object.freeze(entries.slice());
    for (const listener of listeners) listener();
  };

  // `openPanel` is omitted unless a test asks for it: a host with no panel
  // surface of its own leaves the method off entirely, and a fake that always
  // supplied one would hide an unguarded call. Cast because the SDK declares
  // it required.
  const service = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getCapabilities: () => capabilities,
    getMentionableMembers: () => [],

    async createThread({ anchor, content }) {
      // The platform gate: it will not write a thread whose anchor no mounted
      // adapter can resolve, and it takes the quote from that adapter.
      const adapter = Array.from(adapters).find((candidate) => candidate.handles(anchor));
      if (!adapter || adapter.getState(anchor) !== "attached") {
        throw new Error("ANCHOR_NOT_FOUND");
      }
      const comment = {
        actor: { kind: "user" as const, userId: VIEWER.userId, displayName: VIEWER.name },
        author: VIEWER.name,
        content,
        deleted: false,
        id: `comment-${(sequence += 1)}`,
        timeStamp: 1000 + sequence,
        type: "comment" as const,
      };
      const thread: CollaborativeCommentThread = {
        anchor,
        comments: [comment],
        id: `thread-${sequence}`,
        quote: adapter.describe(anchor),
        resolved: false,
        type: "thread",
      };
      entries = [...entries, thread];
      publish();
      return { comment, duplicate: false, thread };
    },

    reply: vi.fn(),
    async setResolved(threadId, resolved) {
      entries = entries.map((thread) =>
        thread.id === threadId ? { ...thread, resolved } : thread
      );
      publish();
    },
    focusThread: vi.fn(async () => true),
    ...(openPanel ? { openPanel } : {}),
    registerAnchorAdapter(adapter: MountedCommentAnchorAdapter) {
      adapters.add(adapter);
      return () => adapters.delete(adapter);
    },
  } as CollaborationCommentsService;

  return {
    service,
    /** Stands in for a delete from another client, the panel, or an MCP tool. */
    deleteThread(threadId: string) {
      entries = entries.filter((thread) => thread.id !== threadId);
      publish();
    },
    /**
     * Stands in for the `comments` chunk of the document landing. Separate from
     * `createThread` because these threads were authored on another machine --
     * they arrive already written, with no local pin write beside them.
     */
    hydrateThreadsFor(pinIds: readonly string[]) {
      entries = [
        ...entries,
        ...pinIds.map((pinId, index) => ({
          anchor: mockupPinAnchor(pinId, "button:Save changes"),
          comments: [
            {
              actor: {
                kind: "user" as const,
                userId: VIEWER.userId,
                displayName: VIEWER.name,
              },
              author: VIEWER.name,
              content: "This gap is wrong",
              deleted: false,
              id: `hydrated-comment-${index}`,
              timeStamp: 10,
              type: "comment" as const,
            },
          ],
          id: `hydrated-thread-${index}`,
          quote: "Pin — Save changes button",
          resolved: false,
          type: "thread" as const,
        })),
      ];
      publish();
    },
    threads: () => entries,
  };
}

/** Records the order of every collection report and every pin deletion. */
function recordingPins(pins: MockupPinStore, log: string[]): MockupPinStore {
  return {
    ...pins,
    delete(pinId) {
      log.push(`delete:${pinId}`);
      return pins.delete(pinId);
    },
  };
}

/** Wire a source and its adapter the way `useMockupComments` does. */
function wire(
  capabilities?: CommentCapabilities,
  canPlace = () => true,
  openPanel?: (input?: { threadId?: string }) => void
) {
  const fake = createFakeService(capabilities, openPanel);
  const pins = createInMemoryMockupPinStore();
  const source = createMockupCommentSource({
    service: fake.service,
    pins,
    viewer: VIEWER,
    canPlace,
    isHydrated: () => true,
    createId: () => "pin-new",
    now: () => 500,
  });
  fake.service.registerAnchorAdapter(
    createMockupPinAnchorAdapter({
      getPins: () => pins.snapshot(),
      // No frame in a node test. Null means "cannot measure", so a pin that
      // exists is attached and a pin that does not is orphaned -- which is the
      // exact distinction the creation gate turns on.
      getDocument: () => null,
      getResolvedPinIds: () => source.getResolvedPinIds(),
    })
  );
  return { ...fake, pins, source };
}

describe("mockup thread creation", () => {
  it("writes the pin and the thread together, with a geometry-free anchor", async () => {
    const { pins, source, threads } = wire();

    const pinId = await source.createThread(DRAFT, "This gap is wrong\nsecond line");

    expect(pinId).toBe("pin-new");
    expect(pins.snapshot()).toEqual([
      { ...DRAFT, id: "pin-new", createdAt: 500, createdBy: "user-1" },
    ]);

    const [thread] = threads();
    expect(thread.anchor).toEqual({
      kind: "entity",
      entityType: "mockup-pin",
      entityId: "pin-new",
      labelSnapshot: "button:Save changes",
    });
    // The shared anchor must never learn about selectors or coordinates.
    expect(JSON.stringify(thread.anchor)).not.toContain("#save");
    expect(JSON.stringify(thread.anchor)).not.toContain("xPct");
    expect(thread.quote).toBe("Pin 1 — Save changes button");
    // A pin click on a host that omits `openPanel` still resolves its thread
    // and must not reach for the missing method.
    expect(source.openThread("pin-new")).toBe(thread.id);
    expect(source.openThread("pin-missing")).toBeNull();
    expect(source.getThreads()[0]).toMatchObject({
      pinId: "pin-new",
      authorName: "Ada",
      preview: "This gap is wrong",
      replyCount: 0,
      resolved: false,
    });
  });

  it("leaves no pin behind when the platform refuses the thread", async () => {
    const { pins, source, service } = wire();
    vi.spyOn(service, "createThread").mockRejectedValueOnce(new Error("ACCESS_DENIED"));

    await expect(source.createThread(DRAFT, "This gap is wrong")).rejects.toThrow(
      "ACCESS_DENIED"
    );

    // An orphan pin is invisible garbage: the only signal that would ever
    // collect it is the thread that was never written.
    expect(pins.snapshot()).toEqual([]);
    expect(source.getThreads()).toEqual([]);
  });

  it("keeps the pin when the thread persisted before a notification failed", async () => {
    const { pins, source, service, threads } = wire();
    const createThread = service.createThread.bind(service);
    vi.spyOn(service, "createThread").mockImplementationOnce(async (input) => {
      await createThread(input);
      throw new Error("NOTIFICATION_FAILED");
    });

    await expect(source.createThread(DRAFT, "This gap is wrong")).resolves.toBe(
      "pin-new"
    );

    expect(threads()).toHaveLength(1);
    expect(pins.snapshot().map(({ id }) => id)).toEqual(["pin-new"]);
  });

  it("collects an interrupted locally-authored pin on a later mount", () => {
    const fake = createFakeService();
    const pins = createInMemoryMockupPinStore();
    pins.create({
      ...DRAFT,
      id: "interrupted-pin",
      createdAt: 1,
      createdBy: VIEWER.userId,
    });
    pins.create({
      ...DRAFT,
      id: "peer-pin",
      createdAt: 1,
      createdBy: "user-2",
    });

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const source = createMockupCommentSource({
      service: fake.service,
      pins,
      viewer: VIEWER,
      isHydrated: () => true,
      now: () => GRACE_MS + 2,
    });
    warn.mockRestore();

    expect(pins.snapshot().map(({ id }) => id)).toEqual(["peer-pin"]);
    source.dispose();
  });

  it("writes nothing for an abandoned composer or a surface that cannot comment", async () => {
    const { pins, source } = wire();
    expect(await source.createThread(DRAFT, "")).toBeNull();
    expect(await source.createThread(DRAFT, "   \n  ")).toBeNull();
    expect(pins.snapshot()).toEqual([]);

    const readOnlySurface = wire(undefined, () => false);
    expect(await readOnlySurface.source.createThread(DRAFT, "Looks off")).toBeNull();
    expect(readOnlySurface.pins.snapshot()).toEqual([]);
  });

  it("asks the host to open its panel on the pin's thread", async () => {
    // The panel is the host's; a pin click has to reach the thread there, or
    // the pin is a marker for a conversation the reader cannot get to.
    const openPanel = vi.fn();
    const { source, threads } = wire(undefined, () => true, openPanel);
    await source.createThread(DRAFT, "This gap is wrong");

    source.openThread("pin-new");
    expect(openPanel).toHaveBeenCalledWith({ threadId: threads()[0].id });
  });
});

describe("pin lifecycle against its thread", () => {
  it("collects the pin when the thread is deleted and keeps it when it is resolved", async () => {
    const { pins, source, service, deleteThread, threads } = wire();
    await source.createThread(DRAFT, "This gap is wrong");
    const [thread] = threads();

    // Resolving is not deleting: the pin survives, it just loses its number.
    await service.setResolved(thread.id, true);
    expect(pins.snapshot().map(({ id }) => id)).toEqual(["pin-new"]);
    expect(source.getThreads()[0].resolved).toBe(true);
    expect(source.getResolvedPinIds().has("pin-new")).toBe(true);

    deleteThread(thread.id);
    expect(pins.snapshot()).toEqual([]);
    expect(source.getThreads()).toEqual([]);
  });

  it("never collects a pin whose thread it has not seen", () => {
    const { pins, source } = wire();
    // A peer's pin can arrive over the wire before their thread does. Treating
    // "no thread yet" as "thread deleted" would delete a live teammate's pin.
    pins.create({
      id: "peer-pin",
      selector: "#hero",
      labelSnapshot: "h1:Welcome",
      offset: { xPct: 0.5, yPct: 0.5 },
      viewport: { width: 1440, label: "Desktop" },
      createdAt: 1,
      createdBy: "user-2",
    });

    expect(source.getThreads()).toEqual([]);
    expect(pins.snapshot().map(({ id }) => id)).toEqual(["peer-pin"]);
  });
});

describe("partially hydrated document", () => {
  it("collects nothing until the comments array has arrived, then only the true orphan", () => {
    // `mockupPins` and `comments` are separate top-level keys in one Y.Doc, and
    // a document syncs incrementally. This is the window where the pins update
    // has applied and the comments update has not: every pin is present, no
    // thread is, and read access -- a permission answer, not a sync one -- is
    // already true.
    const fake = createFakeService({ read: true, comment: true });
    const store = createInMemoryMockupPinStore();
    const log: string[] = [];
    const healthy = Array.from({ length: 19 }, (_, index) => `pin-${index}`);
    for (const id of [...healthy, "interrupted-pin"]) {
      store.create({ ...DRAFT, id, createdAt: 1, createdBy: VIEWER.userId });
    }

    let hydrated = false;
    const warn = vi
      .spyOn(console, "warn")
      .mockImplementation(() => log.push("report"));

    const source = createMockupCommentSource({
      service: fake.service,
      pins: recordingPins(store, log),
      viewer: VIEWER,
      isHydrated: () => hydrated,
      // Every pin is far older than the grace period, so the grace period is
      // doing nothing here. Hydration is the only thing standing between these
      // pins and permanent deletion.
      now: () => GRACE_MS + 2,
    });

    expect(store.snapshot()).toHaveLength(20);
    expect(log).toEqual([]);

    // The comments chunk lands. Nineteen threads were healthy on the server all
    // along; the twentieth pin really was written by a process that died before
    // its thread.
    hydrated = true;
    fake.hydrateThreadsFor(healthy);

    expect([...store.snapshot()].map(({ id }) => id).sort()).toEqual(
      [...healthy].sort()
    );
    // The report precedes the deletion: a collection that dies half way through
    // must still have said what it was about to do.
    expect(log).toEqual(["report", "delete:interrupted-pin"]);
    expect(warn.mock.calls[0]?.[1]).toMatchObject({
      pinIds: ["interrupted-pin"],
      count: 1,
    });

    warn.mockRestore();
    source.dispose();
  });
});

describe("revoked comment access", () => {
  it("stops accepting placements while every existing thread stays readable", async () => {
    const capabilities: CommentCapabilities = { read: true, comment: true };
    const fake = createFakeService(capabilities);
    const pins = createInMemoryMockupPinStore();
    const source = createMockupCommentSource({
      service: fake.service,
      pins,
      viewer: VIEWER,
      createId: () => "pin-new",
    });
    fake.service.registerAnchorAdapter(
      createMockupPinAnchorAdapter({
        getPins: () => pins.snapshot(),
        getDocument: () => null,
      })
    );

    await source.createThread(DRAFT, "This gap is wrong");
    expect(source.canComment()).toBe(true);

    // Downgraded mid-session behind an unchanged service object: the composer
    // goes, the conversation does not.
    capabilities.comment = false;
    expect(source.canComment()).toBe(false);
    expect(await source.createThread(DRAFT, "Another note")).toBeNull();
    expect(source.getThreads()).toHaveLength(1);
    expect(pins.snapshot()).toHaveLength(1);
  });
});
