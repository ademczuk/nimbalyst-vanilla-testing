/**
 * "Show me this comment" requests, addressed by collaborative document URI.
 *
 * Two callers raise the same request and neither can hold a reference to the
 * panel: an extension calling `comments.openPanel(...)` through the SDK, and a
 * comment notification deep link, which fires while the document is still
 * opening and the tab does not exist yet. So a request with no live surface is
 * held until one mounts, and the surface drains it on subscribe.
 *
 * Thread identity only. Nothing here carries a DOM selector, a node key, or a
 * coordinate — where the anchor *is* is answered by whichever adapter is
 * mounted at the time the request lands, never by the request itself.
 */

import type { CommentAnchor } from '@nimbalyst/extension-sdk';

export interface CommentPanelRequest {
  threadId?: string;
  anchor?: CommentAnchor;
  /**
   * A deep link is the user having clicked a notification, so a focus it
   * cannot honour has to be explained. An extension opening its own panel
   * already knows the state of its own canvas.
   */
  source: 'extension' | 'deep-link';
}

type PendingRequest = {
  request: CommentPanelRequest;
  queuedAt: number;
};

/**
 * A queued request outlives the click that made it by however long the document
 * takes to open. Past that it is stale — the user has moved on, and replaying
 * it would yank a later reader to a thread they did not ask for.
 */
const PENDING_TTL_MS = 5 * 60 * 1000;
/** Bounded so a document that never opens a surface cannot accumulate. */
const MAX_PENDING = 16;

const pending = new Map<string, PendingRequest>();
const listeners = new Map<string, Set<(request: CommentPanelRequest) => void>>();

function prunePending(now: number): void {
  for (const [documentUri, entry] of pending) {
    if (now - entry.queuedAt > PENDING_TTL_MS) pending.delete(documentUri);
  }
  while (pending.size > MAX_PENDING) {
    const oldest = pending.keys().next();
    if (oldest.done) break;
    pending.delete(oldest.value);
  }
}

/**
 * Deliver to every mounted surface for the document, or hold the request until
 * one mounts. A newer request replaces an unclaimed older one: the user's most
 * recent click is the one they are waiting on.
 */
export function requestCommentPanel(
  documentUri: string,
  request: CommentPanelRequest,
  now: number = Date.now(),
): void {
  if (!documentUri) return;
  const subscribers = listeners.get(documentUri);
  if (subscribers && subscribers.size > 0) {
    for (const listener of [...subscribers]) listener(request);
    return;
  }
  prunePending(now);
  pending.set(documentUri, { request, queuedAt: now });
}

/**
 * The `onOpenPanel` callback a host that really does mount a comments pane
 * supplies to the SDK comments service. Exported so the wiring is one named
 * thing rather than a line copied into every host that grows a surface.
 */
export function createCommentPanelOpener(
  documentUri: string,
): (input?: { threadId?: string; anchor?: CommentAnchor }) => void {
  return (input) => {
    requestCommentPanel(documentUri, { ...input, source: 'extension' });
  };
}

export function subscribeCommentPanelRequests(
  documentUri: string,
  listener: (request: CommentPanelRequest) => void,
  now: number = Date.now(),
): () => void {
  let subscribers = listeners.get(documentUri);
  if (!subscribers) {
    subscribers = new Set();
    listeners.set(documentUri, subscribers);
  }
  subscribers.add(listener);

  const queued = pending.get(documentUri);
  if (queued) {
    pending.delete(documentUri);
    if (now - queued.queuedAt <= PENDING_TTL_MS) listener(queued.request);
  }

  return () => {
    const current = listeners.get(documentUri);
    current?.delete(listener);
    if (current?.size === 0) listeners.delete(documentUri);
  };
}

/** Test seam. Nothing in the app clears these. */
export function resetCommentPanelRequests(): void {
  pending.clear();
  listeners.clear();
}
