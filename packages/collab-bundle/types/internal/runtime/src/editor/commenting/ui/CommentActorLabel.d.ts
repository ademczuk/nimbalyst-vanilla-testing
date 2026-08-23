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
import type { Comment } from '../types';
/** Display name for an actor, agent or user. */
export declare function commentActorName(comment: Comment): string;
export declare function CommentActorLabel({ comment, onOpenAgentSession, }: {
    comment: Comment;
    onOpenAgentSession?: (sessionId: string) => void;
}): JSX.Element;
