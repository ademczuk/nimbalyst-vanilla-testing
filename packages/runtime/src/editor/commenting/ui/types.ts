/**
 * Editor-neutral view types for the shared comment primitives.
 *
 * Nothing here may reference Lexical marks, the document DOM, or canvas
 * geometry: the same components mount inside a Lexical document pane, a
 * mockup canvas, and a node graph. Where a thread "is" in the document is
 * expressed only as an opaque {@link CommentAnchorState} plus a human-readable
 * label the owning editor supplies.
 */

import type {
  Comment,
  CommentCapabilities,
  CommentMember,
  Thread,
} from '../types';

/**
 * Whether a thread's anchor still points at something.
 *
 * - `attached` — the anchor resolves; focusing it will work.
 * - `orphaned` — the anchor is well-formed but its target is gone (the text was
 *   deleted, the entity was removed). The thread and its history stay visible.
 * - `unsupported` — the anchor kind is not one this editor understands, e.g. an
 *   entity anchor written by a newer client. Never guessed at, never hidden.
 */
export type CommentAnchorState = 'attached' | 'orphaned' | 'unsupported';

/** A thread plus the presentation facts the panel needs to render it. */
export interface CommentThreadView {
  thread: Thread;
  anchorState: CommentAnchorState;
  /**
   * Editor-supplied description of the anchor target ("Node: Launch plan").
   * Falls back to `thread.quote` when absent.
   */
  anchorLabel?: string;
}

/** True when the thread should render in the detached group. */
export function isDetachedThread(view: CommentThreadView): boolean {
  return view.anchorState !== 'attached';
}

/**
 * The live data an editor exposes to {@link useCollaborativeComments}.
 *
 * `getThreads` must return a stable snapshot — the same array identity until
 * something actually changes — because the hook reads it through
 * `useSyncExternalStore`. `YDocCommentRepository` already guarantees this.
 *
 * `getCapabilities` is called on every render and is deliberately never
 * cached: access can be revoked mid-session behind an unchanged source object,
 * and a memoized capability leaves the authoring affordances decorative
 * exactly when it matters.
 */
export interface CollaborativeCommentsSource {
  subscribe(listener: () => void): () => void;
  getThreads(): readonly Thread[];
  getCapabilities(): CommentCapabilities;
  /** Defaults to `attached` for every thread when the editor cannot tell. */
  getAnchorState?(thread: Thread): CommentAnchorState;
  describeAnchor?(thread: Thread): string | undefined;
}

/** Callbacks the panel and thread card raise back to the owning editor. */
export interface CommentThreadActions {
  onSelectThread(threadId: string): void;
  onSetThreadResolved(thread: Thread, resolved: boolean): void;
  onDeleteThread(thread: Thread): void;
  onDeleteComment(comment: Comment, thread: Thread): void;
  onReply(thread: Thread, text: string, mentionedUserIds: string[]): void;
  /**
   * Opens the agent session behind an agent-authored comment. Absent means the
   * host has no session surface, and agent authorship renders as a static
   * label rather than a dead button.
   */
  onOpenAgentSession?(sessionId: string): void;
}

export type { CommentCapabilities, CommentMember };
