// @vitest-environment node

import type { CollabCodec } from '@nimbalyst/extension-sdk';
import {
  createThread,
  YDocCommentRepository,
} from '@nimbalyst/runtime/editor/commenting/YDocCommentRepository';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Doc } from 'yjs';

const boundary = vi.hoisted(() => ({
  acquire: vi.fn(),
  codec: undefined as CollabCodec | undefined,
  getDocuments: vi.fn(),
  getTeamProvider: vi.fn(),
  notify: vi.fn(),
}));

vi.mock('@nimbalyst/collab-adapters', () => ({
  getCollabContentAdapter: () => boundary.codec,
}));

vi.mock('../../store/atoms/collabDocuments', () => ({
  getSharedDocumentsForScopeKey: boundary.getDocuments,
  getTeamSyncProviderForScopeKey: boundary.getTeamProvider,
}));

vi.mock('../CollaborativeEmbedProviderCache', () => ({
  collaborativeEmbedProviderCache: { acquire: boundary.acquire },
}));

vi.mock('../CollaborativeDocumentTypeCatalog', () => ({
  getCollaborativeDocumentTypeCatalog: () => ({
    editorIdForDescriptor: () => 'test.editor',
    resolveMetadata: () => ({
      state: 'ready',
      descriptor: { defaultExtension: '.test' },
    }),
  }),
}));

vi.mock('../documentCommentNotifier', () => ({
  notifyDocumentCommentRecipients: boundary.notify,
}));

import { acquireHeadlessCollabCommentController } from '../HeadlessCollabCommentController';

const DOCUMENT_URI = 'collab://org:org-1:doc:doc-1';
const WORKSPACE_PATH = '/workspace';

function codecWithAnchors(
  commentAnchors: NonNullable<CollabCodec['commentAnchors']>,
): CollabCodec {
  return {
    documentType: 'test',
    fileExtensions: ['.test'],
    layoutVersion: 1,
    isEmpty: () => false,
    seedFromFile: () => {},
    applyFromFile: () => {},
    exportToFile: () => '',
    toPlainText: () => '',
    commentAnchors,
  };
}

function seedEntityThreads(yDoc: Doc, count = 1): void {
  const repository = new YDocCommentRepository(yDoc);
  for (let index = 0; index < count; index += 1) {
    repository.addThread(
      createThread(`Entity ${index}`, [], `thread-${index}`, false, {
        kind: 'entity',
        entityType: 'test-entity',
        entityId: `entity-${index}`,
      }),
    );
  }
  repository.destroy();
}

/** `canAccess` is always called with an action, so type the mock that way --
 *  inferring it from a zero-argument default makes `mock.calls` an empty
 *  tuple and hides the action assertions below. */
type CanAccessMock = Mock<
  (input: { action: string }) => Promise<{ allowed: boolean }>
>;

function provideDocument(
  yDoc: Doc,
  canAccess: CanAccessMock = vi.fn(async (_input: { action: string }) => ({
    allowed: true,
  })),
) {
  (globalThis as { window?: unknown }).window = {
    electronAPI: { org: { canAccess } },
  };
  boundary.getDocuments.mockReturnValue([
    {
      documentId: 'doc-1',
      documentType: 'test',
      editorId: 'test.editor',
      fileExtension: '.test',
      teamProjectId: 'project-1',
      title: 'Security fixture',
    },
  ]);
  boundary.getTeamProvider.mockReturnValue(undefined);
  boundary.acquire.mockResolvedValue({
    resource: {
      config: {
        orgId: 'org-1',
        teamMemberId: 'user-1',
        userName: 'Ada',
      },
      replica: { getOutboxState: () => 'clean' },
      syncProvider: {
        getStatus: () => 'connected',
        getYDoc: () => yDoc,
        isSynced: () => true,
      },
    },
    release: vi.fn(),
  });
  return canAccess;
}

describe('HeadlessCollabCommentController security', () => {
  let priorWindow: unknown;

  beforeEach(() => {
    priorWindow = (globalThis as { window?: unknown }).window;
  });

  afterEach(() => {
    (globalThis as { window?: unknown }).window = priorWindow;
    boundary.codec = undefined;
    vi.clearAllMocks();
  });

  it('runs all anchors in one list call against one detached Y.Doc snapshot', async () => {
    const yDoc = new Doc();
    yDoc.getMap('content').set('safe', true);
    seedEntityThreads(yDoc, 2);
    provideDocument(yDoc);
    const codecDocs = new Set<Doc>();
    boundary.codec = codecWithAnchors({
      handles: (anchor) => anchor.kind === 'entity',
      getState(codecDoc) {
        codecDocs.add(codecDoc);
        codecDoc.getMap('content').set('injected', true);
        return 'attached';
      },
      describe: () => '',
    });
    const liveUpdates = vi.fn();
    yDoc.on('update', liveUpdates);

    const acquisition = await acquireHeadlessCollabCommentController(
      DOCUMENT_URI,
      WORKSPACE_PATH,
    );
    try {
      const listed = acquisition.controller.list();
      expect(listed.threads.map((thread) => thread.anchorState)).toEqual([
        'attached',
        'attached',
      ]);
      expect(codecDocs.size).toBe(1);
      expect(codecDocs.has(yDoc)).toBe(false);
      expect(yDoc.getMap('content').has('injected')).toBe(false);
      expect(liveUpdates).not.toHaveBeenCalled();
    } finally {
      acquisition.release();
    }
  });

  it('fails a throwing codec closed without changing the live document', async () => {
    const yDoc = new Doc();
    seedEntityThreads(yDoc);
    provideDocument(yDoc);
    boundary.codec = codecWithAnchors({
      handles: (anchor) => anchor.kind === 'entity',
      getState(codecDoc) {
        codecDoc.getMap('content').set('injected-before-throw', true);
        throw new Error('codec failure');
      },
      describe: () => '',
    });

    const acquisition = await acquireHeadlessCollabCommentController(
      DOCUMENT_URI,
      WORKSPACE_PATH,
    );
    try {
      expect(acquisition.controller.list().threads[0].anchorState).toBe(
        'orphaned',
      );
      expect(yDoc.getMap('content').has('injected-before-throw')).toBe(false);
    } finally {
      acquisition.release();
    }
  });

  it('derives comment capability from comment access rather than edit access', async () => {
    const yDoc = new Doc();
    seedEntityThreads(yDoc);
    const canAccess = provideDocument(
      yDoc,
      vi.fn(async ({ action }: { action: string }) => ({
        allowed: action !== 'edit',
      })),
    );
    boundary.codec = codecWithAnchors({
      handles: () => true,
      getState: () => 'attached',
      describe: () => '',
    });

    const acquisition = await acquireHeadlessCollabCommentController(
      DOCUMENT_URI,
      WORKSPACE_PATH,
    );
    try {
      expect(acquisition.controller.getCapabilities()).toEqual({
        read: true,
        comment: true,
      });
      expect(canAccess.mock.calls.map(([input]) => input.action)).toEqual([
        'view',
        'comment',
      ]);
    } finally {
      acquisition.release();
    }
  });
});
