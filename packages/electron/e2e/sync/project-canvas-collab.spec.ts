/**
 * Wrangler-backed Project Canvas collaboration acceptance test.
 *
 * The recipient starts with no parent/child document replica. Both renderers
 * then open one shared canvas containing ten visible shared document cards.
 * The test races edits through the canvas binding and through a nested Mockup
 * editor, measures the renderer-wide child-room cap, and finally reads the
 * Durable Objects' decrypted update logs directly. Local replicas are never
 * used as sync evidence.
 *
 * Run with:
 *   RUN_COLLAB_TESTS=1 npx playwright test e2e/sync/project-canvas-collab.spec.ts --max-failures=1
 */

import { expect, test, type Page } from "@playwright/test";
import WebSocket from "ws";
import * as Y from "yjs";

import {
  NIMBALYST_CANVAS_NAMESPACE,
  canvasCollabCodec,
  readCanvasDocumentFromYDoc,
} from "@nimbalyst/runtime/canvas";
import { TwoClientCollabHarness } from "../utils/twoClientCollab";

test.skip(
  () => !process.env.RUN_COLLAB_TESTS,
  "Requires RUN_COLLAB_TESTS=1 and wrangler dev"
);
test.describe.configure({ mode: "serial" });

const PORT = 8798;
const CHILD_COUNT = 10;
const NESTED_EDIT_CHILD_INDEX = 6;

interface ServerDocumentExport {
  updates: Array<{ sequence: number; plaintext: string }>;
  snapshot: { plaintext: string; replacesUpTo: number } | null;
  counts: { updates: number; hasSnapshot: boolean };
}

function testAuthUrl(harness: TwoClientCollabHarness, suffix: string): URL {
  const url = new URL(`http://127.0.0.1:${harness.port}${suffix}`);
  url.searchParams.set("test_user_id", harness.ownerUserId);
  url.searchParams.set("test_org_id", harness.orgId);
  return url;
}

async function registerServerDocuments(
  harness: TwoClientCollabHarness,
  documents: Array<{
    documentId: string;
    title: string;
    documentType: string;
    fileExtension: string;
    editorId: string;
  }>
): Promise<void> {
  const url = new URL(
    `ws://127.0.0.1:${harness.port}/sync/org:${harness.orgId}:team`
  );
  url.searchParams.set("test_user_id", harness.ownerUserId);
  url.searchParams.set("test_org_id", harness.orgId);
  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });

  try {
    for (const document of documents) {
      const ack = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () =>
            reject(new Error(`Timed out registering ${document.documentId}`)),
          10_000
        );
        const onMessage = (data: WebSocket.RawData) => {
          const message = JSON.parse(data.toString()) as {
            type?: string;
            documentId?: string;
            code?: string;
            message?: string;
          };
          if (message.type === "error") {
            clearTimeout(timeout);
            socket.off("message", onMessage);
            reject(
              new Error(
                `${message.code ?? "server_error"}: ${message.message ?? ""}`
              )
            );
          } else if (
            message.type === "docIndexRegistered" &&
            message.documentId === document.documentId
          ) {
            clearTimeout(timeout);
            socket.off("message", onMessage);
            resolve();
          }
        };
        socket.on("message", onMessage);
      });
      socket.send(
        JSON.stringify({
          type: "docIndexRegister",
          documentId: document.documentId,
          encryptedTitle: document.title,
          titleIv: "",
          documentType: document.documentType,
          metadataVersion: 2,
          fileExtension: document.fileExtension,
          editorId: document.editorId,
          projectId: null,
        })
      );
      await ack;
    }
  } finally {
    socket.close();
  }
}

async function writeDocument(
  page: Page,
  documentId: string,
  documentType: string,
  content: string
): Promise<void> {
  const result = (await page.evaluate(
    async (input) => (window as any).__writeCollabDocTest(input),
    { documentId, documentType, content }
  )) as { ok?: boolean; success?: boolean; status?: string; error?: string };
  expect(
    result.ok ?? result.success ?? result.status !== "error",
    result.error
  ).not.toBe(false);
}

async function exportServerDocument(
  harness: TwoClientCollabHarness,
  documentId: string
): Promise<ServerDocumentExport> {
  const encodedRoom = `org:${harness.orgId}:doc:${encodeURIComponent(
    documentId
  )}`;
  const url = testAuthUrl(harness, `/sync/${encodedRoom}/internal/export-doc`);
  url.searchParams.set("orgId", harness.orgId);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Server export ${documentId} failed: ${
        response.status
      } ${await response.text()}`
    );
  }
  return response.json() as Promise<ServerDocumentExport>;
}

function serverYDoc(serverExport: ServerDocumentExport): Y.Doc {
  const yDoc = new Y.Doc();
  const replacesUpTo = serverExport.snapshot?.replacesUpTo ?? 0;
  if (serverExport.snapshot) {
    Y.applyUpdate(yDoc, Buffer.from(serverExport.snapshot.plaintext, "base64"));
  }
  for (const update of serverExport.updates) {
    if (update.sequence > replacesUpTo) {
      Y.applyUpdate(yDoc, Buffer.from(update.plaintext, "base64"));
    }
  }
  return yDoc;
}

function makeParentCanvas(orgId: string, childIds: string[]): string {
  const nodes = childIds.map((documentId, index) => ({
    id: `child-${index}`,
    type: "file",
    file: `Shared ${index + 1}.mockup.html`,
    x: (index % 5) * 150,
    y: Math.floor(index / 5) * 175,
    width: 140,
    height: 165,
    "x-nimbalyst": {
      label: `Shared ${index + 1}`,
      reference: {
        kind: "doc",
        uri: `nimbalyst://doc/${encodeURIComponent(orgId)}/${encodeURIComponent(
          documentId
        )}`,
      },
    },
  }));
  nodes.push(
    {
      id: "native-a",
      type: "text",
      text: "alpha initial",
      x: 0,
      y: 365,
      width: 300,
      height: 120,
      "x-nimbalyst": {
        label: "Native alpha",
        reference: { kind: "native", nativeKind: "text" },
      },
    },
    {
      id: "native-b",
      type: "text",
      text: "bravo initial",
      x: 320,
      y: 365,
      width: 300,
      height: 120,
      "x-nimbalyst": {
        label: "Native bravo",
        reference: { kind: "native", nativeKind: "text" },
      },
    }
  );
  return `${JSON.stringify(
    {
      nodes,
      edges: [],
      "x-nimbalyst": {
        version: 1,
        meta: {
          name: "Collaboration ceiling",
          // Deliberately fit all ten shared cards inside the warm LOD band so
          // this test saturates the room policy instead of merely observing
          // however many cards happen to fit at 1x in the test window.
          viewport: { x: 30, y: 30, zoom: 0.5 },
        },
      },
    },
    null,
    2
  )}\n`;
}

async function activateCard(page: Page, nodeId: string): Promise<void> {
  const card = page.locator(`[data-canvas-node-id="${nodeId}"]`);
  await expect(card).toBeVisible({ timeout: 20_000 });
  // Warm cards intentionally make their body inert; activation belongs to
  // React Flow's node click handler on the card root, which also performs the
  // zoom-to-hot transition.
  // The test app's session-history pane can overlap transformed canvas
  // coordinates even though the node remains visible. Dispatching on the root
  // still drives React Flow's real node-click handler without relying on the
  // unrelated shell pane's hit-testing geometry.
  await card.dispatchEvent("click");
  await expect(card).toHaveClass(/canvas-card--active/);
}

async function appendMockupComment(
  page: Page,
  nodeId: string,
  marker: string
): Promise<void> {
  const card = page.locator(`[data-canvas-node-id="${nodeId}"]`);
  const editor = card.locator(".mockup-editor");
  await expect(editor).toBeVisible({ timeout: 20_000 });
  const textarea = editor.locator(".mockup-source-editor");
  if ((await textarea.count()) === 0) {
    await editor.locator(".mockup-view-source-button").dispatchEvent("click");
  }
  await expect(textarea).toBeVisible({ timeout: 10_000 });
  await textarea.focus();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End"
  );
  await page.keyboard.insertText(`\n<!-- ${marker} -->`);
}

test("two clients converge while shared child rooms stay below the measured ceiling", async () => {
  test.setTimeout(180_000);
  const harness = new TwoClientCollabHarness({ port: PORT });
  const parentId = `project-canvas-${harness.runId}`;
  const childIds = Array.from(
    { length: CHILD_COUNT },
    (_, index) => `project-canvas-child-${index}-${harness.runId}`
  );
  const documents = [
    {
      documentId: parentId,
      title: "Collaboration ceiling.canvas",
      documentType: "canvas",
      fileExtension: ".canvas",
      editorId: "builtin.canvas",
    },
    ...childIds.map((documentId, index) => ({
      documentId,
      title: `Shared ${index + 1}.mockup.html`,
      documentType: "mockup.html",
      fileExtension: ".mockup.html",
      editorId: "com.nimbalyst.mockuplm",
    })),
  ];

  try {
    await harness.start();
    // B has not opened any room. Closing it before the seed leaves it with no
    // parent or child replica, so its later render must come from Wrangler.
    await harness.closeClient("B");
    await registerServerDocuments(harness, documents);

    await harness.openSharedMode("A");
    for (const childId of childIds) {
      await harness.registerDocumentConfig("A", {
        documentId: childId,
        title: `${childId}.mockup.html`,
        documentType: "mockup.html",
      });
      await writeDocument(
        harness.clientA.page,
        childId,
        "mockup.html",
        `<!doctype html><html><body><main>Seed ${childId}</main></body></html>`
      );
    }
    await harness.registerDocumentConfig("A", {
      documentId: parentId,
      title: "Collaboration ceiling.canvas",
      documentType: "canvas",
    });
    await writeDocument(
      harness.clientA.page,
      parentId,
      "canvas",
      makeParentCanvas(harness.orgId, childIds)
    );

    const seededParent = serverYDoc(
      await exportServerDocument(harness, parentId)
    );
    expect(canvasCollabCodec.exportToFile(seededParent)).toContain(
      "Collaboration ceiling"
    );
    seededParent.destroy();

    await harness.restartClient("B");
    await Promise.all([
      harness.openSharedMode("A"),
      harness.openSharedMode("B"),
    ]);
    await Promise.all([
      harness.clientA.page
        .getByTestId("collab-sidebar")
        .getByText("Collaboration ceiling.canvas", { exact: true })
        .click(),
      harness.clientB.page
        .getByTestId("collab-sidebar")
        .getByText("Collaboration ceiling.canvas", { exact: true })
        .click(),
    ]);

    for (const page of [harness.clientA.page, harness.clientB.page]) {
      await expect(
        page.locator('.canvas-editor[data-canvas-collaborative="true"]')
      ).toBeVisible({
        timeout: 20_000,
      });
      await expect(
        page.locator('[data-canvas-room-connection="active"]')
      ).toHaveCount(8, {
        timeout: 30_000,
      });
      await expect(
        page.locator('[data-canvas-room-connection="queued"]')
      ).toHaveCount(2);
    }

    const policySnapshots = await Promise.all(
      [harness.clientA.page, harness.clientB.page].map((page) =>
        page.evaluate(() =>
          (window as any).__NIMBALYST_CANVAS_ROOM_POLICY__.snapshot()
        )
      )
    );
    expect(policySnapshots).toEqual([
      { limit: 8, active: 8, queued: 2, hot: 0, warm: 8 },
      { limit: 8, active: 8, queued: 2, hot: 0, warm: 8 },
    ]);

    const childConnectionCounts = await Promise.all(
      childIds.map(async (childId) => {
        const encodedRoom = `org:${harness.orgId}:doc:${encodeURIComponent(
          childId
        )}`;
        const response = await fetch(
          testAuthUrl(harness, `/sync/${encodedRoom}/status`)
        );
        expect(response.ok).toBe(true);
        return ((await response.json()) as { connections: number }).connections;
      })
    );
    // Eight child slots in each of two renderers: the DOs observe exactly
    // sixteen live child connections, never twenty.
    expect(childConnectionCounts.reduce((sum, count) => sum + count, 0)).toBe(
      16
    );

    await Promise.all([
      activateCard(harness.clientA.page, "native-a"),
      activateCard(harness.clientB.page, "native-b"),
    ]);
    await Promise.all([
      harness.clientA.page
        .locator('[data-canvas-node-id="native-a"] .canvas-card__text-input')
        .fill("alpha edited by A"),
      harness.clientB.page
        .locator('[data-canvas-node-id="native-b"] .canvas-card__text-input')
        .fill("bravo edited by B"),
    ]);
    await expect(
      harness.clientA.page.locator(
        '[data-canvas-node-id="native-b"] .canvas-card__text'
      )
    ).toContainText("bravo edited by B", { timeout: 20_000 });
    await expect(
      harness.clientB.page.locator(
        '[data-canvas-node-id="native-a"] .canvas-card__text'
      )
    ).toContainText("alpha edited by A", { timeout: 20_000 });

    const nestedNodeId = `child-${NESTED_EDIT_CHILD_INDEX}`;
    await Promise.all([
      activateCard(harness.clientA.page, nestedNodeId),
      activateCard(harness.clientB.page, nestedNodeId),
    ]);
    await Promise.all([
      appendMockupComment(
        harness.clientA.page,
        nestedNodeId,
        "nested edit from A"
      ),
      appendMockupComment(
        harness.clientB.page,
        nestedNodeId,
        "nested edit from B"
      ),
    ]);
    for (const page of [harness.clientA.page, harness.clientB.page]) {
      const source = page.locator(
        `[data-canvas-node-id="${nestedNodeId}"] .mockup-source-editor`
      );
      await expect(source).toHaveValue(/nested edit from A/, {
        timeout: 20_000,
      });
      await expect(source).toHaveValue(/nested edit from B/, {
        timeout: 20_000,
      });
    }

    await expect
      .poll(
        async () => {
          const yDoc = serverYDoc(
            await exportServerDocument(harness, parentId)
          );
          const content = canvasCollabCodec.exportToFile(yDoc);
          yDoc.destroy();
          return content;
        },
        { timeout: 20_000 }
      )
      .toContain("alpha edited by A");
    const serverParent = serverYDoc(
      await exportServerDocument(harness, parentId)
    );
    const serverParentContent = canvasCollabCodec.exportToFile(serverParent);
    serverParent.destroy();
    expect(serverParentContent).toContain("bravo edited by B");

    await expect
      .poll(
        async () => {
          const yDoc = serverYDoc(
            await exportServerDocument(
              harness,
              childIds[NESTED_EDIT_CHILD_INDEX]
            )
          );
          const html = yDoc.getText("html").toString();
          yDoc.destroy();
          return html;
        },
        { timeout: 20_000 }
      )
      .toContain("nested edit from A");
    const serverChild = serverYDoc(
      await exportServerDocument(
        harness,
        childIds[NESTED_EDIT_CHILD_INDEX]
      )
    );
    const serverChildHtml = serverChild.getText("html").toString();
    serverChild.destroy();
    expect(serverChildHtml).toContain("nested edit from B");

    // The viewport is per-user view state, not shared document state. One
    // client changing its own view must leave the other client's view alone and
    // must never rewrite `meta.viewport` -- that field is the board's saved
    // home view, not a live broadcast of wherever the last person scrolled to.
    const viewportTransform = (page: Page): Promise<string> =>
      page
        .locator(".canvas-surface .react-flow__viewport")
        .first()
        .evaluate((element) => (element as HTMLElement).style.transform);
    const viewportBeforeB = await viewportTransform(harness.clientB.page);

    const paneBox = await harness.clientA.page
      .locator(".canvas-surface .react-flow__pane")
      .boundingBox();
    if (!paneBox) throw new Error("Canvas pane has no box on client A");
    // Escape first: an activated card carries `nowheel`, and zooming is the one
    // viewport gesture that needs no empty pane to start from.
    await harness.clientA.page.keyboard.press("Escape");
    await harness.clientA.page.mouse.move(
      paneBox.x + paneBox.width / 2,
      paneBox.y + paneBox.height / 2
    );
    await harness.clientA.page.mouse.wheel(0, -240);

    // A real edit right behind the gesture. Once B has the text, whatever the
    // viewport change broadcast has arrived too, so the assertions below are
    // an observation rather than a race.
    await activateCard(harness.clientA.page, "native-a");
    await harness.clientA.page
      .locator('[data-canvas-node-id="native-a"] .canvas-card__text-input')
      .fill("alpha moved its own view");
    await expect(
      harness.clientB.page.locator(
        '[data-canvas-node-id="native-a"] .canvas-card__text'
      )
    ).toContainText("alpha moved its own view", { timeout: 20_000 });

    // Presence crosses the wire, not just document state. A has `native-a`
    // focused, so B renders it as claimed -- the same per-card claimant path an
    // agent's working-set declaration lands on, driven here by a human because
    // a human is what this harness has two of.
    await expect(
      harness.clientB.page.locator(
        '[data-canvas-node-id="native-a"].canvas-card--claimed'
      )
    ).toHaveCount(1, { timeout: 20_000 });

    expect(await viewportTransform(harness.clientB.page)).toBe(viewportBeforeB);
    const movedParent = serverYDoc(
      await exportServerDocument(harness, parentId)
    );
    const movedMeta =
      readCanvasDocumentFromYDoc(movedParent)[NIMBALYST_CANVAS_NAMESPACE]?.meta;
    movedParent.destroy();
    expect(movedMeta?.viewport).toEqual({ x: 30, y: 30, zoom: 0.5 });
  } finally {
    await harness.stop();
  }
});
