/**
 * React view model over a live comment source.
 *
 * Subscribes to threads through `useSyncExternalStore`, which is why
 * `getThreads` has to return a stable snapshot — `YDocCommentRepository`
 * already does. Capabilities and anchor state are read on every render and
 * deliberately never memoized: access can be revoked, and an entity can be
 * deleted, behind a source object that keeps its identity. A cached read there
 * leaves the authoring affordances decorative exactly when it matters.
 */
import type { CollaborativeCommentsSource, CommentCapabilities, CommentThreadView } from './types';
export interface CollaborativeCommentsView {
    /** Every thread, in source order, with its live anchor state. */
    threads: CommentThreadView[];
    capabilities: CommentCapabilities;
    canRead: boolean;
    canComment: boolean;
    resolvedCount: number;
    detachedCount: number;
    /** Threads a reader still has to act on: open and attached. */
    openCount: number;
}
export declare function useCollaborativeComments(source: CollaborativeCommentsSource | null | undefined): CollaborativeCommentsView;
