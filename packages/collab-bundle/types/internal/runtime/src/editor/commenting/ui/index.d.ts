/**
 * Editor-neutral collaborative comment UI.
 *
 * These primitives are mounted by the Lexical document editor and by
 * extension editors that have no Lexical, no document DOM, and no canvas
 * geometry in common with it. Nothing exported here may reach for any of
 * those; an editor describes where a thread is anchored only through
 * `CommentAnchorState` and a label.
 *
 * Importing from this module also loads the shared stylesheet. Deep-importing
 * an individual component skips it.
 */
import './comments.css';
export { CollaborativeCommentsPanel, groupCommentThreads } from './CollaborativeCommentsPanel';
export type { CollaborativeCommentsPanelProps } from './CollaborativeCommentsPanel';
export { CommentActorLabel, commentActorName } from './CommentActorLabel';
export { CommentComposer, readMentionQuery } from './CommentComposer';
export type { CommentComposerProps } from './CommentComposer';
export { CommentCountBadge } from './CommentCountBadge';
export type { CommentCountBadgeProps } from './CommentCountBadge';
export { CommentMentionPicker, mentionOptionId } from './CommentMentionPicker';
export type { CommentMentionPickerProps } from './CommentMentionPicker';
export { CommentThreadCard } from './CommentThreadCard';
export type { CommentThreadCardProps } from './CommentThreadCard';
export { AUTHOR_COLOR_FOREGROUND, authorColor, authorInitial, } from './authorColor';
export { filterMentionCandidates, retainMentionableUserIds, useMentionRoster, } from './mentionRoster';
export { isDetachedThread } from './types';
export type { CollaborativeCommentsSource, CommentAnchorState, CommentThreadActions, CommentThreadView, } from './types';
export { useCollaborativeComments } from './useCollaborativeComments';
export type { CollaborativeCommentsView } from './useCollaborativeComments';
