// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Doc } from 'yjs';

import {
  collabCommentAnchorAdapterRegistry,
  collabCommentControllerRegistry,
} from '@nimbalyst/runtime/editor/commenting/CollabCommentControllerRegistry';
import {
  createComment,
  createThread,
  YDocCommentRepository,
} from '@nimbalyst/runtime/editor/commenting/YDocCommentRepository';
import type { CommentAnchor } from '@nimbalyst/runtime/editor/commenting/types';

// Only the authenticated room and catalog boundaries are replaced. Both
// controllers under comparison are the production implementations.
const boundary = vi.hoisted(() => ({
  acquire: vi.fn(),
  getDocuments: vi.fn(),
  getTeamProvider: vi.fn(),
  notify: vi.fn(),
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
    editorIdForDescriptor: () => 'com.nimbalyst.mockuplm',
    resolveMetadata: () => ({
      state: 'ready',
      descriptor: { defaultExtension: '.mockup.html' },
    }),
  }),
}));
vi.mock('../documentCommentNotifier', () => ({
  notifyDocumentCommentRecipients: boundary.notify,
}));

import { createHostedCollaborationComments } from '../../components/TabEditor/collaborationCommentsService';
import { acquireHeadlessCollabCommentController } from '../HeadlessCollabCommentController';

const DOCUMENT_URI = 'collab://org:org-1:doc:mockup-1';
const WORKSPACE_PATH = '/workspace';
const TITLE = 'Checkout review';

const PIN_ANCHOR: CommentAnchor = {
  kind: 'entity',
  entityType: 'mockup-pin',
  entityId: 'pin-1',
  labelSnapshot: 'button:Save changes',
};

function seedThreads(yDoc: Doc): void {
  const repository = new YDocCommentRepository(yDoc);
  repository.addThread(
    createThread(
      'Pin 1 — Save changes button',
      [
        createComment('Please shorten this label', 'Reviewer', {
          actor: { kind: 'user', userId: 'user-2', displayName: 'Reviewer' },
          id: 'comment-1',
          timeStamp: 100,
        }),
      ],
      'thread-pinned',
      false,
      PIN_ANCHOR,
    ),
  );
  // A thread from before structured anchors existed: no anchor at all.
  repository.addThread(
    createThread(
      'Legacy quote',
      [
        createComment('Older note', 'Reviewer', {
          actor: { kind: 'user', userId: 'user-2', displayName: 'Reviewer' },
          id: 'comment-2',
          timeStamp: 120,
        }),
      ],
      'thread-legacy',
      false,
    ),
  );
  repository.destroy();
}

describe('mounted and headless comment reads', () => {
  let priorWindow: unknown;

  beforeEach(() => {
    priorWindow = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = {
      electronAPI: { org: { canAccess: vi.fn(async () => ({ allowed: true })) } },
    };
    boundary.getDocuments.mockReturnValue([
      {
        documentId: 'mockup-1',
        documentType: 'mockup.html',
        editorId: 'com.nimbalyst.mockuplm',
        fileExtension: '.mockup.html',
        teamProjectId: 'project-1',
        title: TITLE,
      },
    ]);
    boundary.getTeamProvider.mockReturnValue(undefined);
  });

  afterEach(() => {
    (globalThis as { window?: unknown }).window = priorWindow;
    collabCommentControllerRegistry.clear();
    collabCommentAnchorAdapterRegistry.clear();
    vi.clearAllMocks();
  });

  it('returns identical thread data whether or not the document is open', async () => {
    const yDoc = new Doc();
    seedThreads(yDoc);
    boundary.acquire.mockResolvedValue({
      resource: {
        config: { orgId: 'org-1', teamMemberId: 'user-1', userName: 'Ada' },
        replica: { getOutboxState: () => 'clean' },
        syncProvider: {
          getStatus: () => 'connected',
          getYDoc: () => yDoc,
          isSynced: () => true,
        },
      },
      release: vi.fn(),
    });

    const mounted = createHostedCollaborationComments({
      yDoc,
      host: {
        currentUser: { id: 'user-1', name: 'Ada' },
        documentId: 'mockup-1',
        documentTitle: TITLE,
        documentUri: DOCUMENT_URI,
        instanceId: 'tab-one',
        getMembers: () => [],
        isActive: () => true,
        isVisible: () => true,
        isHydrated: () => true,
        resolveCapabilities: async () => ({ read: true, comment: true }),
      },
    });
    mounted.service.registerAnchorAdapter({
      handles: (anchor) => anchor.kind === 'entity',
      getState: () => 'attached',
      describe: () => 'Pin 1 — Save changes button',
      focus: () => true,
    });
    await vi.waitFor(() =>
      expect(mounted.service.getCapabilities().read).toBe(true),
    );

    const headless = await acquireHeadlessCollabCommentController(
      DOCUMENT_URI,
      WORKSPACE_PATH,
    );

    try {
      const fromMountedTab = mounted.controller.list();
      const fromClosedDocument = headless.controller.list();

      // The whole result, not a field-by-field spot check: an agent asking
      // "which element is this comment on?" must get the same answer either
      // way, so any future divergence in either path fails here.
      expect(fromMountedTab).toEqual(fromClosedDocument);
      expect(fromMountedTab.threads).toEqual([
        expect.objectContaining({
          id: 'thread-pinned',
          anchor: PIN_ANCHOR,
          anchorState: 'attached',
        }),
        expect.objectContaining({ id: 'thread-legacy', anchorState: 'orphaned' }),
      ]);
      expect(fromMountedTab.threads[1]).not.toHaveProperty('anchor');
    } finally {
      headless.release();
      mounted.destroy();
    }
  });
});
