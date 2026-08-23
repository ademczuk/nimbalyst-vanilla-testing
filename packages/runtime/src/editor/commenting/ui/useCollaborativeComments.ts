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

import { useMemo, useSyncExternalStore } from 'react';

import type { Thread } from '../types';
import type {
  CollaborativeCommentsSource,
  CommentAnchorState,
  CommentCapabilities,
  CommentThreadView,
} from './types';

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

const EMPTY_THREADS: readonly Thread[] = Object.freeze([]);

export function useCollaborativeComments(
  source: CollaborativeCommentsSource | null | undefined,
): CollaborativeCommentsView {
  const subscribe = useMemo(
    () =>
      source
        ? (listener: () => void) => source.subscribe(listener)
        : () => () => {},
    [source],
  );
  const getThreads = useMemo(
    () => (source ? () => source.getThreads() : () => EMPTY_THREADS),
    [source],
  );

  const threads = useSyncExternalStore(subscribe, getThreads, getThreads);

  // Called through the source so a class-based implementation keeps its
  // `this`, and called on every render so a revocation lands on the next one.
  const capabilities: CommentCapabilities = source
    ? source.getCapabilities()
    : { read: false, comment: false };

  const views: CommentThreadView[] = [];
  let resolvedCount = 0;
  let detachedCount = 0;
  let openCount = 0;

  for (const thread of threads) {
    const anchorState: CommentAnchorState =
      source?.getAnchorState?.(thread) ?? 'attached';
    views.push({
      thread,
      anchorState,
      anchorLabel: source?.describeAnchor?.(thread),
    });
    if (thread.resolved) resolvedCount += 1;
    else if (anchorState !== 'attached') detachedCount += 1;
    else openCount += 1;
  }

  return {
    threads: views,
    capabilities,
    canRead: capabilities.read,
    canComment: capabilities.comment,
    resolvedCount,
    detachedCount,
    openCount,
  };
}
