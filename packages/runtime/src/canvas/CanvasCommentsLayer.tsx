/**
 * The board's share of the comment UI: pins, card badges, and a composer.
 *
 * Everything else -- the thread list, replies, mentions, resolve, delete, the
 * detached group, the agent-session link -- is the host's comments panel, which
 * this reaches through `service.openPanel`. Nothing in this file renders a
 * thread, and nothing in it should start to. If a comment needs a new control,
 * it belongs in `CollaborativeCommentsPanel`, where every editor gets it.
 *
 * Positioning notes, both consequences of NIM-3845:
 *
 * - **Pins live in `ViewportPortal`,** so their coordinates are plain board
 *   coordinates and they pan and zoom with the cards they annotate. The marker
 *   counter-scales so it stays legible and clickable at any zoom. A plain
 *   `<button>` under a CSS transform hit-tests correctly -- the spike's failure
 *   was libraries deriving content coordinates from `getBoundingClientRect`,
 *   which nothing here does.
 * - **The composer is a React Flow `Panel`,** outside the transform entirely.
 *   A textarea rendered on the board would be 6px tall at half zoom, and its
 *   mention picker would be the one popover on this surface that had to reason
 *   about scale. Screen space is simply the right space for a form.
 */

import { createContext, memo, type JSX } from 'react';
import { ViewportPortal, useStore } from '@xyflow/react';

import { CommentCountBadge } from '../editor/commenting/ui/CommentCountBadge';

import type {
  CanvasCardCommentCounts,
  CanvasCommentThreadView,
} from './canvasComments';

/**
 * What a card needs to know about comments.
 *
 * A context rather than node `data`, for the same reason the claim map is one:
 * a comment arriving must not rebuild every node object and re-run the diff
 * that decides which cards moved. Null when the board has no comment room --
 * which is every private `.canvas` file, so it is the common case, not an edge.
 */
export interface CanvasCardCommentsAccess {
  counts: ReadonlyMap<string, CanvasCardCommentCounts>;
  canComment: boolean;
  /** Reveal this card's first open thread in the host's panel. */
  onOpenCardThread(nodeId: string): void;
  /** Start a new thread anchored to this card. */
  onCommentOnCard(nodeId: string): void;
}

export const CanvasCardCommentsContext =
  createContext<CanvasCardCommentsAccess | null>(null);

export interface CanvasCommentPinsProps {
  threads: readonly CanvasCommentThreadView[];
  /** Show resolved pins too. Off by default: a resolved pin is history. */
  showResolved?: boolean;
  onOpenThread(threadId: string): void;
}

/** Free-floating pins. Card threads are shown on their card, not here. */
export function CanvasCommentPins({
  threads,
  showResolved = false,
  onOpenThread,
}: CanvasCommentPinsProps): JSX.Element | null {
  const zoom = useStore((state) => state.transform[2]);
  const pins = threads.filter(
    (thread) =>
      thread.target.kind === 'point' && (showResolved || !thread.resolved)
  );
  if (pins.length === 0) return null;

  return (
    <ViewportPortal>
      <div className="canvas-comment-pins">
        {pins.map((thread) => {
          const point =
            thread.target.kind === 'point'
              ? thread.target.point
              : { x: 0, y: 0 };
          return (
            <div
              key={thread.threadId}
              className="canvas-comment-pins__anchor"
              style={{ left: point.x, top: point.y }}
            >
              <button
                type="button"
                className={`canvas-comment-pin${
                  thread.resolved ? ' canvas-comment-pin--resolved' : ''
                }`}
                style={{
                  transform: `scale(${1 / Math.max(zoom, 0.05)})`,
                  transformOrigin: 'top left',
                }}
                data-canvas-comment-thread={thread.threadId}
                title={`${thread.authorName}: ${thread.preview}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenThread(thread.threadId);
                }}
              >
                <span className="canvas-comment-pin__dot" />
                <span className="canvas-comment-pin__preview">
                  {thread.preview}
                </span>
                {thread.replyCount > 0 && (
                  <span className="canvas-comment-pin__replies">
                    {thread.replyCount}
                  </span>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </ViewportPortal>
  );
}

export interface CanvasCardCommentBadgesProps {
  counts: CanvasCardCommentCounts;
  onOpen?: () => void;
}

/**
 * Two counts, side by side, never added.
 *
 * The left badge counts threads on the *card* -- remarks about this thing's
 * place on this board. The right one counts threads inside the card's *own
 * document*, which live in that document's comment room and are visible to
 * people who have never opened this board. They are different conversations
 * with different audiences, so they get different badges, different labels, and
 * different titles. An unknown in-document count renders as nothing at all:
 * see `CanvasCardCommentCounts`.
 */
export const CanvasCardCommentBadges = memo(function CanvasCardCommentBadges({
  counts,
  onOpen,
}: CanvasCardCommentBadgesProps): JSX.Element | null {
  const showDocument = counts.inDocument !== null && counts.inDocument > 0;
  if (counts.onCanvas <= 0 && !showDocument) return null;

  return (
    <span className="canvas-card-comments" data-testid="canvas-card-comments">
      {counts.onCanvas > 0 && (
        <button
          type="button"
          className="canvas-card-comments__button"
          title={`${counts.onCanvas} comment ${
            counts.onCanvas === 1 ? 'thread' : 'threads'
          } on this card`}
          onClick={(event) => {
            event.stopPropagation();
            onOpen?.();
          }}
        >
          <CommentCountBadge
            count={counts.onCanvas}
            className="canvas-card-comments__badge canvas-card-comments__badge--canvas"
            label={`${counts.onCanvas} comment threads on this card`}
          />
        </button>
      )}
      {showDocument && (
        <span
          className="canvas-card-comments__document"
          title={`${counts.inDocument} comment ${
            counts.inDocument === 1 ? 'thread' : 'threads'
          } inside this document`}
        >
          <CommentCountBadge
            count={counts.inDocument as number}
            className="canvas-card-comments__badge canvas-card-comments__badge--document"
            label={`${counts.inDocument} comment threads inside this document`}
          />
        </span>
      )}
    </span>
  );
});

/**
 * The composer lives in `./CanvasCommentComposer` and is fetched on demand --
 * it drags the mention picker and `@floating-ui/react`, which no reader needs
 * until they start writing. See that module's header.
 */
export type { CanvasCommentComposerProps } from './CanvasCommentComposer';
