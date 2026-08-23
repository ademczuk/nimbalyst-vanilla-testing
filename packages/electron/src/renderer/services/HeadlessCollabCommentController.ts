import { getCollabContentAdapter } from '@nimbalyst/collab-adapters';
import { parseCollabUri } from '@nimbalyst/collab-protocol';
import {
  collabCommentAnchorAdapterRegistry,
  createRepositoryCollabCommentController,
  type CollabCommentController,
} from '@nimbalyst/runtime/editor/commenting/CollabCommentControllerRegistry';
import {
  type ThreadSnapshot,
  YDocCommentRepository,
} from '@nimbalyst/runtime/editor/commenting/YDocCommentRepository';
import {
  COMMENT_BOUNDS,
  CollabCommentControllerError,
  truncateCommentUtf8,
} from '@nimbalyst/runtime/editor/commenting/commentValidation';
import type {
  Comment,
  CommentAnchor,
  CommentActor,
  CommentCapabilities,
  CommentMentionPayload,
} from '@nimbalyst/runtime/editor/commenting/types';
import { applyUpdateV2, Doc, encodeStateAsUpdateV2 } from 'yjs';

import {
  getSharedDocumentsForScopeKey,
  getTeamSyncProviderForScopeKey,
} from '../store/atoms/collabDocuments';
import { teamMemberDisplayName } from '../utils/teamMemberDisplayName';
import { collaborativeEmbedProviderCache } from './CollaborativeEmbedProviderCache';
import { getCollaborativeDocumentTypeCatalog } from './CollaborativeDocumentTypeCatalog';
import { notifyDocumentCommentRecipients } from './documentCommentNotifier';

const HYDRATION_TIMEOUT_MS = 10_000;
const FLUSH_TIMEOUT_MS = 5_000;
const NO_COMMENT_CAPABILITIES = Object.freeze({
  read: false,
  comment: false,
});

type DocumentCommentAccessSource = {
  canAccess(input: {
    orgId?: string | null;
    projectId?: string | null;
    action: 'view' | 'comment' | 'edit' | 'admin';
  }): Promise<{ allowed: boolean }>;
};

function getDocumentCommentAccessSource():
  | DocumentCommentAccessSource
  | undefined {
  return (
    window.electronAPI as ElectronAPI & {
      org?: DocumentCommentAccessSource;
    }
  ).org;
}

function createCodecAnchorReadSnapshot(
  documentType: string,
  yDoc: Doc,
): {
  getState(anchor: CommentAnchor): 'attached' | 'orphaned';
  describe(anchor: CommentAnchor): string;
} {
  const snapshot = new Doc();
  applyUpdateV2(snapshot, encodeStateAsUpdateV2(yDoc));
  const capability = getCollabContentAdapter(documentType)?.commentAnchors;
  return {
    getState(anchor) {
      if (!capability || !capability.handles(anchor)) return 'orphaned';
      return capability.getState(snapshot, anchor);
    },
    describe(anchor) {
      if (!capability || !capability.handles(anchor)) return '';
      return capability.describe(snapshot, anchor);
    },
  };
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs: number,
  message: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new CollabCommentControllerError('SYNC_TIMEOUT', message);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

export interface HeadlessCollabCommentAcquisition {
  controller: CollabCommentController;
  flush(): Promise<void>;
  release(): void;
}

/**
 * Acquire comments through the authenticated collaborative embed cache. The
 * controller operates directly on the hydrated Y.Doc and never creates a
 * Lexical editor. Codec anchor support is registered as a non-visible fallback
 * so a visible mounted adapter remains authoritative.
 */
export async function acquireHeadlessCollabCommentController(
  documentUri: string,
  workspacePath: string,
): Promise<HeadlessCollabCommentAcquisition> {
  const { orgId, documentId } = parseCollabUri(documentUri);
  const document = getSharedDocumentsForScopeKey(workspacePath).find(
    (candidate) => candidate.documentId === documentId,
  );
  if (!document) {
    throw new Error(
      `The shared document ${documentId} is not available in this workspace.`,
    );
  }

  const catalog = getCollaborativeDocumentTypeCatalog();
  const resolution = catalog.resolveMetadata(
    document.documentType,
    document.fileExtension,
    document.editorId,
  );
  if (resolution.state !== 'ready') throw new Error(resolution.reason);
  const descriptor = resolution.descriptor;
  const acquisition = await collaborativeEmbedProviderCache.acquire({
    workspacePath,
    orgId,
    documentId,
    title: document.title,
    documentType: document.documentType,
    metadata: {
      metadataVersion: 2,
      fileExtension: document.fileExtension ?? descriptor.defaultExtension,
      editorId: document.editorId ?? catalog.editorIdForDescriptor(descriptor),
    },
  });

  let repository: YDocCommentRepository | undefined;
  let unregisterCodecAnchors: (() => void) | undefined;
  try {
    await waitUntil(
      () => acquisition.resource.syncProvider.isSynced(),
      HYDRATION_TIMEOUT_MS,
      'Timed out while hydrating collaborative document comments.',
    );

    const yDoc = acquisition.resource.syncProvider.getYDoc();
    repository = new YDocCommentRepository(yDoc);
    const config = acquisition.resource.config;
    const currentUser = {
      id: config.teamMemberId,
      name: config.userName || config.userEmail || config.teamMemberId,
    };
    const teamProvider = getTeamSyncProviderForScopeKey(workspacePath);
    const getMembers = () =>
      (teamProvider?.getTeamState()?.members ?? [])
        .filter((member) => member.userId !== currentUser.id)
        .map((member) => ({
          userId: member.userId,
          name: teamMemberDisplayName(member),
          email: member.email,
          personalOrgId: member.personalOrgId,
        }));

    let capabilities: CommentCapabilities = NO_COMMENT_CAPABILITIES;
    const refreshCapabilities = async (): Promise<CommentCapabilities> => {
      const canAccess = getDocumentCommentAccessSource()?.canAccess;
      if (typeof canAccess !== 'function') {
        capabilities = NO_COMMENT_CAPABILITIES;
        return capabilities;
      }
      try {
        const accessInput = {
          orgId: config.orgId,
          projectId: document.teamProjectId,
        };
        const [readAccess, commentAccess] = await Promise.all([
          canAccess({ ...accessInput, action: 'view' }),
          canAccess({ ...accessInput, action: 'comment' }),
        ]);
        capabilities = Object.freeze({
          read: readAccess.allowed,
          comment: readAccess.allowed && commentAccess.allowed,
        });
      } catch {
        capabilities = NO_COMMENT_CAPABILITIES;
      }
      return capabilities;
    };
    await refreshCapabilities();

    unregisterCodecAnchors = collabCommentAnchorAdapterRegistry.register({
      documentUri,
      instanceId: `headless-codec:${documentId}`,
      isActive: () => false,
      isVisible: () => false,
      adapter: {
        handles(anchor) {
          const capability = getCollabContentAdapter(
            document.documentType,
          )?.commentAnchors;
          return capability?.handles(anchor) === true;
        },
        getState(anchor) {
          return createCodecAnchorReadSnapshot(
            document.documentType,
            yDoc,
          ).getState(anchor);
        },
        describe(anchor) {
          return createCodecAnchorReadSnapshot(
            document.documentType,
            yDoc,
          ).describe(anchor);
        },
        focus: () => false,
        createReadSnapshot: () =>
          createCodecAnchorReadSnapshot(document.documentType, yDoc),
      },
    });

    const notifyCommitted = (event: {
      actor: CommentActor;
      comment: Readonly<Comment>;
      mentionedUserIds: string[];
      replyRecipientUserIds: string[];
      thread: ThreadSnapshot;
    }): void => {
      const actorName =
        event.actor.kind === 'agent'
          ? event.actor.sessionName
          : event.actor.displayName;
      const mentionRecipients = event.mentionedUserIds.filter(
        (id) => id !== currentUser.id,
      );
      const payload: CommentMentionPayload = {
        actorName,
        sourceTitle: document.title,
        snippet: truncateCommentUtf8(
          event.comment.content,
          COMMENT_BOUNDS.maxAnchorContextBytes,
        ),
        commentId: event.comment.id,
        threadId: event.thread.id,
        markId: event.thread.id,
        url: documentUri,
      };
      notifyDocumentCommentRecipients({
        workspacePath,
        documentId,
        reason: 'mention',
        recipientUserIds: mentionRecipients,
        payload,
      });
      notifyDocumentCommentRecipients({
        workspacePath,
        documentId,
        reason: 'reply',
        recipientUserIds: event.replyRecipientUserIds.filter(
          (id) => id !== currentUser.id && !mentionRecipients.includes(id),
        ),
        payload,
      });
    };

    // No wrapper around the shared controller. The mounted comments service
    // builds the same factory over its own live Y.Doc, and any behaviour added
    // here would show up only when the document happens to be closed.
    const controller: CollabCommentController =
      createRepositoryCollabCommentController({
        repository,
        currentUser,
        documentTitle: document.title,
        documentUri,
        getCapabilities: () => capabilities,
        getMembers,
        isHydrated: () => acquisition.resource.syncProvider.isSynced(),
        isVisible: () => false,
        beforeMutation: async () => {
          await refreshCapabilities();
        },
        onCommitted: notifyCommitted,
      });

    let released = false;
    return {
      controller,
      async flush() {
        await new Promise((resolve) => setTimeout(resolve, 0));
        await waitUntil(
          () =>
            acquisition.resource.replica.getOutboxState() === 'clean' &&
            acquisition.resource.syncProvider.getStatus() === 'connected',
          FLUSH_TIMEOUT_MS,
          'Timed out while flushing the collaborative comment mutation.',
        );
      },
      release() {
        if (released) return;
        released = true;
        unregisterCodecAnchors?.();
        repository?.destroy();
        acquisition.release();
      },
    };
  } catch (error) {
    unregisterCodecAnchors?.();
    repository?.destroy();
    acquisition.release();
    throw error;
  }
}
