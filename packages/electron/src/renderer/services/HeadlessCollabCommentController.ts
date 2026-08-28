import { getCollabContentAdapter } from '@nimbalyst/collab-adapters';
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

import { teamMemberDisplayName } from '../utils/teamMemberDisplayName';
import {
  acquireHeadlessCollabDocument,
  HeadlessCollabDocumentError,
} from './HeadlessCollabDocument';
import { notifyDocumentCommentRecipients } from './documentCommentNotifier';

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

/**
 * The acquisition layer speaks a document-level error vocabulary; the comment
 * tools have their own wire contract (`code` on the IPC result). Translate at
 * this seam so the codes agents see do not change just because the underlying
 * acquisition became shared.
 */
function asCommentError(error: unknown): unknown {
  if (!(error instanceof HeadlessCollabDocumentError)) return error;
  if (error.code === 'ROOM_UNREACHABLE' || error.code === 'FLUSH_TIMEOUT') {
    return new CollabCommentControllerError('SYNC_TIMEOUT', error.message);
  }
  return error;
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
  let acquisition: Awaited<ReturnType<typeof acquireHeadlessCollabDocument>>;
  try {
    acquisition = await acquireHeadlessCollabDocument(
      documentUri,
      workspacePath,
    );
  } catch (error) {
    throw asCommentError(error);
  }
  const document = acquisition.document;
  const documentId = document.documentId;

  let repository: YDocCommentRepository | undefined;
  let unregisterCodecAnchors: (() => void) | undefined;
  try {
    const yDoc = acquisition.yDoc;
    repository = new YDocCommentRepository(yDoc);
    const config = acquisition.config;
    const currentUser = {
      id: config.teamMemberId,
      name: config.userName || config.userEmail || config.teamMemberId,
    };
    const teamProvider = acquisition.getTeamProvider();
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
        isHydrated: () => acquisition.syncProvider.isSynced(),
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
        try {
          await acquisition.flush();
        } catch (error) {
          throw asCommentError(error);
        }
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
