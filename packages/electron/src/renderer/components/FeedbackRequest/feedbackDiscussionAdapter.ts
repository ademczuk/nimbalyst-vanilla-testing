/**
 * The request's discussion, as a `CommentAdapter`.
 *
 * A feedback request carries its own thread (`FeedbackRequest.discussion`), and
 * `CommentRef.sourceKind` already spells `feedbackRequest`, so the thread is
 * rendered by the same `CommentThread` that rooms, DMs, tracker comments and
 * document discussions use. Nothing about a thread hung off a request is
 * special enough to justify a second renderer, a second composer, and a second
 * set of mention and attachment rules.
 *
 * Reads come from the request state atom the feedback IPC listener writes, the
 * same way `ConversationCommentAdapter` reads conversation events. Writes go
 * through an injected `post`: this module deliberately does not reach for an
 * IPC channel, so a caller with no transport gets no adapter rather than a
 * composer that silently drops what someone typed.
 */

import type {
  Actor,
  Comment,
  CommentAdapter,
  CommentCapabilities,
  CommentChange,
  CommentPage,
  CommentRef,
  CreateCommentInput,
  FeedbackDiscussionComment,
  RichCommentBody,
} from '@nimbalyst/collab-protocol';
import type { Store } from 'jotai/vanilla/store';

import type { FeedbackRequestServiceTarget } from '../../../shared/feedbackRequest';
import {
  feedbackRequestStateForTargetAtomFamily,
  feedbackRequestTargetKey,
} from '../../store/atoms/feedbackRequests';

export interface FeedbackDiscussionAdapterConfig {
  target: FeedbackRequestServiceTarget;
  viewerActor: Actor;
  capabilities: CommentCapabilities;
  store: Store;
  /** Appends a comment to the request's thread and resolves once it is stored. */
  post: (input: CreateCommentInput) => Promise<FeedbackDiscussionComment>;
  /** Absent when the surface cannot edit or delete; the rows already gate on capabilities. */
  update?: (
    commentId: string,
    body: RichCommentBody,
  ) => Promise<FeedbackDiscussionComment>;
  remove?: (commentId: string) => Promise<void>;
}

export function materializeFeedbackDiscussion(
  discussion: readonly FeedbackDiscussionComment[],
  config: Pick<
    FeedbackDiscussionAdapterConfig,
    'target' | 'viewerActor' | 'capabilities'
  >,
): Comment[] {
  return [...discussion]
    .sort((left, right) =>
      left.createdAt - right.createdAt || left.id.localeCompare(right.id))
    .map((entry) => ({
      ref: {
        orgId: config.target.orgId,
        sourceKind: 'feedbackRequest' as const,
        sourceId: config.target.requestId,
        commentId: entry.id,
      },
      actor: entry.actor,
      body: entry.body,
      createdAt: entry.createdAt,
      editedAt: entry.editedAt,
      deletedAt: entry.deletedAt,
      replyToCommentId: entry.replyToCommentId,
      resourceRefs: [],
      reactions: [],
      capabilities: capabilitiesFor(entry.actor, config),
    }));
}

function capabilitiesFor(
  actor: Actor,
  config: Pick<FeedbackDiscussionAdapterConfig, 'viewerActor' | 'capabilities'>,
): CommentCapabilities {
  const own = actor.onBehalfOfUserId === config.viewerActor.onBehalfOfUserId;
  return {
    ...config.capabilities,
    editOwn: own && config.capabilities.editOwn,
    deleteOwn: own && config.capabilities.deleteOwn,
  };
}

export function createFeedbackDiscussionAdapter(
  config: FeedbackDiscussionAdapterConfig,
): CommentAdapter {
  const stateAtom = feedbackRequestStateForTargetAtomFamily(
    feedbackRequestTargetKey(config.target),
  );

  const currentComments = (): Comment[] =>
    materializeFeedbackDiscussion(
      config.store.get(stateAtom).request?.discussion ?? [],
      config,
    );

  const refFor = (commentId: string): CommentRef => ({
    orgId: config.target.orgId,
    sourceKind: 'feedbackRequest',
    sourceId: config.target.requestId,
    commentId,
  });

  const asComment = (entry: FeedbackDiscussionComment): Comment => ({
    ref: refFor(entry.id),
    actor: entry.actor,
    body: entry.body,
    createdAt: entry.createdAt,
    editedAt: entry.editedAt,
    deletedAt: entry.deletedAt,
    replyToCommentId: entry.replyToCommentId,
    resourceRefs: [],
    reactions: [],
    capabilities: capabilitiesFor(entry.actor, config),
  });

  return {
    // The request state atom already holds the thread, so reopening a request
    // paints from here instead of waiting out a round trip for what we have.
    snapshot: currentComments,

    async list(): Promise<CommentPage> {
      return { comments: currentComments() };
    },

    async create(input: CreateCommentInput): Promise<Comment> {
      return asComment(await config.post(input));
    },

    async edit(ref: CommentRef, body: RichCommentBody): Promise<Comment> {
      if (!config.update) throw new Error('This discussion cannot be edited here.');
      return asComment(await config.update(ref.commentId, body));
    },

    async remove(ref: CommentRef): Promise<void> {
      if (!config.remove) throw new Error('This discussion cannot be edited here.');
      await config.remove(ref.commentId);
    },

    subscribe(onChange: (change: CommentChange) => void): () => void {
      let previous = new Map(
        currentComments().map((comment) => [comment.ref.commentId, comment]),
      );
      return config.store.sub(stateAtom, () => {
        const next = new Map(
          currentComments().map((comment) => [comment.ref.commentId, comment]),
        );
        for (const [id, comment] of next) {
          const before = previous.get(id);
          if (!before) onChange({ type: 'created', comment });
          else if (JSON.stringify(before) !== JSON.stringify(comment)) {
            onChange({ type: 'updated', comment });
          }
        }
        for (const [id, comment] of previous) {
          if (!next.has(id)) onChange({ type: 'removed', ref: comment.ref });
        }
        previous = next;
      });
    },
  };
}
