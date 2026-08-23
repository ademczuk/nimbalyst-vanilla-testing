import * as Y from "yjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerCollabContentAdapter } from "@nimbalyst/collab-adapters";
import {
  createComment,
  createThread,
  YDocCommentRepository,
} from "@nimbalyst/runtime/editor/commenting/YDocCommentRepository";
import { MockupHtmlCollabContentAdapter } from "../MockupCollabContentAdapters";
import { mockupPinAnchor } from "../../comments/mockupPinAnchor";
import { getYMockupPins, type MockupPin } from "../seed";

// Only the authenticated room/catalog boundaries are replaced below. The
// acquired headless controller, codec registry, Y.Doc repository, list, reply,
// and flush paths are the production implementations used by the MCP handlers.
const host = vi.hoisted(() => ({
  acquire: vi.fn(),
  getDocuments: vi.fn(),
  getTeamProvider: vi.fn(),
  notify: vi.fn(),
}));

vi.mock(
  "../../../../../electron/src/renderer/store/atoms/collabDocuments",
  () => ({
    getSharedDocumentsForScopeKey: host.getDocuments,
    getTeamSyncProviderForScopeKey: host.getTeamProvider,
  })
);

vi.mock(
  "../../../../../electron/src/renderer/services/CollaborativeEmbedProviderCache",
  () => ({
    collaborativeEmbedProviderCache: { acquire: host.acquire },
  })
);

vi.mock(
  "../../../../../electron/src/renderer/services/CollaborativeDocumentTypeCatalog",
  () => ({
    getCollaborativeDocumentTypeCatalog: () => ({
      editorIdForDescriptor: () => "com.nimbalyst.mockuplm",
      resolveMetadata: () => ({
        state: "ready",
        descriptor: { defaultExtension: ".mockup.html" },
      }),
    }),
  })
);

vi.mock(
  "../../../../../electron/src/renderer/services/documentCommentNotifier",
  () => ({ notifyDocumentCommentRecipients: host.notify })
);

import { acquireHeadlessCollabCommentController } from "../../../../../electron/src/renderer/services/HeadlessCollabCommentController";

const DOCUMENT_URI = "collab://org:org-1:doc:mockup-1";
const WORKSPACE_PATH = "/workspace";

function pin(): MockupPin {
  return {
    id: "pin-1",
    selector: "#save",
    labelSnapshot: "button:Save changes",
    offset: { xPct: 0.5, yPct: 0.5 },
    viewport: { width: 1440, label: "Desktop" },
    createdAt: 100,
    createdBy: "user-2",
  };
}

describe("closed mockup comment tools", () => {
  let restoreElectronApi: unknown;

  beforeEach(() => {
    restoreElectronApi = window.electronAPI;
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        org: {
          canAccess: vi.fn(async () => ({ allowed: true })),
        },
      },
    });
    host.getDocuments.mockReturnValue([
      {
        documentId: "mockup-1",
        documentType: "mockup.html",
        editorId: "com.nimbalyst.mockuplm",
        fileExtension: ".mockup.html",
        teamProjectId: "project-1",
        title: "Checkout review",
      },
    ]);
    host.getTeamProvider.mockReturnValue(undefined);
  });

  afterEach(() => {
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: restoreElectronApi,
    });
    vi.clearAllMocks();
  });

  it("lists and replies through the real repository-backed headless controller", async () => {
    const yDoc = new Y.Doc();
    MockupHtmlCollabContentAdapter.seedFromFile(
      yDoc,
      '<button id="save">Save changes</button>'
    );
    const value = pin();
    getYMockupPins(yDoc).set(value.id, value);
    const anchor = mockupPinAnchor(value.id, value.labelSnapshot);
    const seedRepository = new YDocCommentRepository(yDoc);
    seedRepository.addThread(
      createThread(
        "Pin 1 — Save changes button",
        [
          createComment("Please shorten this label", "Reviewer", {
            actor: {
              kind: "user",
              userId: "user-2",
              displayName: "Reviewer",
            },
            id: "comment-1",
            timeStamp: 100,
          }),
        ],
        "thread-1",
        false,
        anchor
      )
    );
    seedRepository.destroy();

    const releaseResource = vi.fn();
    host.acquire.mockResolvedValue({
      resource: {
        config: {
          orgId: "org-1",
          teamMemberId: "user-1",
          userName: "Ada",
        },
        replica: { getOutboxState: () => "clean" },
        syncProvider: {
          getStatus: () => "connected",
          getYDoc: () => yDoc,
          isSynced: () => true,
        },
      },
      release: releaseResource,
    });
    const codecRegistration = registerCollabContentAdapter(
      MockupHtmlCollabContentAdapter
    );
    const acquisition = await acquireHeadlessCollabCommentController(
      DOCUMENT_URI,
      WORKSPACE_PATH
    );

    try {
      const listed = acquisition.controller.list();
      expect(listed.threads).toEqual([
        expect.objectContaining({
          anchor,
          anchorState: "attached",
          id: "thread-1",
          quote: "Pin 1 — Save changes button",
        }),
      ]);

      const actor = acquisition.controller.createAgentActor({
        sessionId: "session-1",
        sessionName: "Mockup agent",
      });
      const replied = await acquisition.controller.reply(
        {
          body: "Addressed in the regenerated mockup.",
          clientMutationId: "reply-1",
          replyToCommentId: "comment-1",
          threadId: "thread-1",
        },
        actor
      );
      await acquisition.flush();

      expect(replied).toMatchObject({
        duplicate: false,
        threadId: "thread-1",
        comment: {
          body: "Addressed in the regenerated mockup.",
          replyToCommentId: "comment-1",
        },
      });
      expect(acquisition.controller.list().threads[0].comments).toHaveLength(2);
    } finally {
      acquisition.release();
      codecRegistration.unregister();
    }

    expect(releaseResource).toHaveBeenCalledOnce();
  });
});
