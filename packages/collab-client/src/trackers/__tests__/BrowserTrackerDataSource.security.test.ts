// @vitest-environment node

import { indexedDB as fakeIndexedDB } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { asTeamJwt, asTeamMemberId } from "@nimbalyst/runtime/auth/jwtScopes";
import { IndexedDbTrackerPersistence } from "@nimbalyst/runtime/sync/trackerPersistence";
import { encodeTrackerPayloadPlaintext } from "@nimbalyst/runtime/sync/trackerEnvelopeCodec";
import type { TrackerItemPayload } from "@nimbalyst/runtime/sync/trackerProtocol";
import { BrowserTrackerDataSource } from "../browser/BrowserTrackerDataSource";

const databases: string[] = [];
const sources: BrowserTrackerDataSource[] = [];

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 500
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("waitUntil timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function payload(itemId: string): TrackerItemPayload {
  return {
    itemId,
    primaryType: "bug",
    archived: false,
    bodyVersion: 0,
    fields: { title: "Cached security finding", status: "to-do" },
    labels: {},
    comments: [],
    system: {},
  };
}

class FailedUpgradeSocket extends EventTarget {
  readyState: number = WebSocket.CONNECTING;

  fail(): void {
    this.dispatchEvent(new Event("error"));
    this.dispatchEvent(new CloseEvent("close", { code: 1006 }));
  }

  send(): void {}

  close(): void {
    this.readyState = WebSocket.CLOSED;
  }
}

describe("BrowserTrackerDataSource authorization", () => {
  afterEach(async () => {
    for (const source of sources.splice(0)) source.dispose();
    await new Promise((resolve) => setTimeout(resolve, 0));
    vi.unstubAllGlobals();
    await Promise.all(
      databases.splice(0).map(
        (databaseName) =>
          new Promise<void>((resolve, reject) => {
            const request = fakeIndexedDB.deleteDatabase(databaseName);
            request.addEventListener("success", () => resolve(), {
              once: true,
            });
            request.addEventListener("error", () => reject(request.error), {
              once: true,
            });
          })
      )
    );
  });

  it("turns a 403 room denial into terminal access loss without exposing or retaining cached rows", async () => {
    const databaseName = `browser-tracker-security-${crypto.randomUUID()}`;
    databases.push(databaseName);
    const persistence = new IndexedDbTrackerPersistence(
      databaseName,
      fakeIndexedDB
    );
    const cached = payload("cached-after-revocation");
    await persistence.applyRemoteItem(
      {
        itemId: cached.itemId,
        syncId: 7,
        encryptedPayload: encodeTrackerPayloadPlaintext(cached),
        updatedAt: Date.now(),
        deletedAt: null,
        orgKeyFingerprint: null,
      },
      cached
    );

    const authorizationProbe = vi.fn(
      async () =>
        new Response("Forbidden: Not authorized for this project", {
          status: 403,
        })
    );
    vi.stubGlobal("fetch", authorizationProbe);

    const source = new BrowserTrackerDataSource({
      workspacePath: "web://org-security/project-security",
      serverUrl: "wss://sync.example.test",
      orgId: "org-security",
      teamProjectId: "project-security",
      teamMemberId: asTeamMemberId("member-revoked"),
      currentUser: {
        email: "revoked@example.test",
        displayName: "Revoked Member",
        gitName: null,
        gitEmail: null,
      },
      presenceIdentity: { displayName: "Revoked Member", avatarUrl: null },
      getTeamJwt: async () => asTeamJwt("revoked-team-jwt"),
      persistence,
      createWebSocket: () => {
        throw new Error(
          "A denied authorization probe must prevent the WebSocket attempt"
        );
      },
    });
    sources.push(source);

    await waitUntil(() => source.status().access !== null);

    expect(authorizationProbe).toHaveBeenCalledOnce();
    expect(source.status()).toMatchObject({
      status: "error",
      access: { reason: "tracker-access-revoked" },
    });
    expect((await source.snapshot()).items).toEqual([]);
    expect((await source.command({ type: "list-items" })).items).toEqual([]);
    await waitUntil(async () => (await persistence.listItems()).length === 0);

    const raceDatabaseName = `browser-tracker-upgrade-security-${crypto.randomUUID()}`;
    databases.push(raceDatabaseName);
    const racePersistence = new IndexedDbTrackerPersistence(
      raceDatabaseName,
      fakeIndexedDB
    );
    const raceCached = payload("cached-before-failed-upgrade");
    await racePersistence.applyRemoteItem(
      {
        itemId: raceCached.itemId,
        syncId: 8,
        encryptedPayload: encodeTrackerPayloadPlaintext(raceCached),
        updatedAt: Date.now(),
        deletedAt: null,
        orgKeyFingerprint: null,
      },
      raceCached
    );
    const failedUpgradeProbe = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("Expected WebSocket", { status: 400 })
      )
      .mockResolvedValueOnce(
        new Response("Forbidden: Not authorized for this project", {
          status: 403,
        })
      );
    vi.stubGlobal("fetch", failedUpgradeProbe);
    const failedUpgrade = new FailedUpgradeSocket();
    let exposedCachedRows = false;
    const raceSource = new BrowserTrackerDataSource({
      workspacePath: "web://org-security/project-security",
      serverUrl: "wss://sync.example.test",
      orgId: "org-security",
      teamProjectId: "project-security",
      teamMemberId: asTeamMemberId("member-revoked"),
      currentUser: {
        email: "revoked@example.test",
        displayName: "Revoked Member",
        gitName: null,
        gitEmail: null,
      },
      presenceIdentity: { displayName: "Revoked Member", avatarUrl: null },
      getTeamJwt: async () => asTeamJwt("revoked-team-jwt"),
      persistence: racePersistence,
      createWebSocket: () => {
        queueMicrotask(() => failedUpgrade.fail());
        return failedUpgrade as unknown as WebSocket;
      },
    });
    sources.push(raceSource);
    raceSource.subscribe((change) => {
      if (
        (change.type === "items-replaced" ||
          change.type === "items-upserted") &&
        change.items.length > 0
      ) {
        exposedCachedRows = true;
      }
    });

    await waitUntil(() => raceSource.status().access !== null);
    expect(failedUpgradeProbe).toHaveBeenCalledTimes(2);
    expect(raceSource.status().access?.reason).toBe("tracker-access-revoked");
    expect(exposedCachedRows).toBe(false);
    expect((await raceSource.snapshot()).items).toEqual([]);
    await waitUntil(
      async () => (await racePersistence.listItems()).length === 0
    );
  });
});
