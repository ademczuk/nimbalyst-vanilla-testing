/**
 * Author line for a single comment.
 *
 * User and agent authorship must stay distinguishable at a glance: an agent
 * comment carries the session name, an "Agent" pill, and — when the host can
 * open sessions — a button onto the session that wrote it. A user comment is a
 * plain name. Both get the same deterministic identity disc so the same person
 * is the same color on every client (see {@link authorColor}).
 */

import type { JSX } from 'react';

import { normalizeCommentActor } from '../YDocCommentRepository';
import type { Comment } from '../types';
import {
  AUTHOR_COLOR_FOREGROUND,
  authorColor,
  authorInitial,
} from './authorColor';

/** Display name for an actor, agent or user. */
export function commentActorName(comment: Comment): string {
  const actor = normalizeCommentActor(comment.actor, comment.author);
  return actor.kind === 'agent' ? actor.sessionName : actor.displayName;
}

/** Identity key for the color disc; agents key off their session. */
function commentActorKey(comment: Comment): string {
  const actor = normalizeCommentActor(comment.actor, comment.author);
  return actor.kind === 'agent'
    ? actor.sessionId
    : (actor.userId ?? actor.displayName);
}

function CommentActorAvatar({ comment }: { comment: Comment }): JSX.Element {
  const key = commentActorKey(comment);
  return (
    <span
      aria-hidden="true"
      className="nim-comment-avatar"
      style={{
        background: authorColor(key),
        color: AUTHOR_COLOR_FOREGROUND,
      }}
    >
      {authorInitial(commentActorName(comment), key)}
    </span>
  );
}

export function CommentActorLabel({
  comment,
  onOpenAgentSession,
}: {
  comment: Comment;
  onOpenAgentSession?: (sessionId: string) => void;
}): JSX.Element {
  const actor = normalizeCommentActor(comment.actor, comment.author);

  if (actor.kind === 'user') {
    return (
      <span className="nim-comment-actor">
        <CommentActorAvatar comment={comment} />
        <span className="nim-comment-author">{actor.displayName}</span>
      </span>
    );
  }

  const body = (
    <>
      <CommentActorAvatar comment={comment} />
      <span className="material-symbols-outlined">smart_toy</span>
      <span>{actor.sessionName}</span>
      <span className="nim-comment-agent-badge">Agent</span>
      {actor.onBehalfOfDisplayName && (
        <span className="nim-comment-agent-owner">
          for {actor.onBehalfOfDisplayName}
        </span>
      )}
    </>
  );

  if (!onOpenAgentSession) {
    return (
      <span className="nim-comment-actor nim-comment-agent-author">{body}</span>
    );
  }

  return (
    <button
      type="button"
      className="nim-comment-actor nim-comment-agent-author"
      title={`Open agent session ${actor.sessionName}`}
      onClick={(event) => {
        event.stopPropagation();
        onOpenAgentSession(actor.sessionId);
      }}
    >
      {body}
    </button>
  );
}
