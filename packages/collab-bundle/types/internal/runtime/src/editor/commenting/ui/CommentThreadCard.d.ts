/**
 * One comment thread: its anchor line, its comments, and the affordances that
 * act on it.
 *
 * The card knows nothing about how the thread is attached to the document. It
 * is handed an anchor state and a label; whether that came from a Lexical
 * MarkNode, a mockup element id, or a graph node is the owning editor's
 * business. A thread whose anchor is gone renders exactly as loudly as one
 * that is attached — the history is the point, and it is never hidden or
 * deleted because the target disappeared.
 */
import type { JSX, Ref } from 'react';
import type { Thread } from '../types';
import type { CommentAnchorState, CommentMember, CommentThreadActions } from './types';
export interface CommentThreadCardProps extends CommentThreadActions {
    thread: Thread;
    /** Defaults to `attached`. */
    anchorState?: CommentAnchorState;
    /** Falls back to `thread.quote`. */
    anchorLabel?: string;
    isActive: boolean;
    /** False for a read-only viewer: reading stays, authoring disappears. */
    canComment: boolean;
    getMembers(): CommentMember[];
    /** Set by the panel's roving tabindex; defaults to focusable. */
    tabIndex?: number;
    cardRef?: Ref<HTMLDivElement>;
    /** Composer autofocus, for a thread the user just created. */
    autoFocusComposer?: boolean;
}
export declare function CommentThreadCard({ thread, anchorState, anchorLabel, isActive, canComment, getMembers, tabIndex, cardRef, autoFocusComposer, onSelectThread, onSetThreadResolved, onDeleteThread, onDeleteComment, onReply, onOpenAgentSession, }: CommentThreadCardProps): JSX.Element;
