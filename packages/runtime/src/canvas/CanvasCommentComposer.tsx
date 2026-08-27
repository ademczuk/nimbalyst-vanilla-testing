/**
 * The board's comment composer, in its own module so it can be fetched late.
 *
 * Split out of `CanvasCommentsLayer` for a bundle reason, not a code-structure
 * one. `CommentComposer` brings the mention picker, and the mention picker
 * brings `@floating-ui/react`; a static edge from the layer put both in the
 * `./canvas` entry's *eager* graph, so opening a board downloaded the composer
 * for every reader who never wrote a comment. It measured at ~42 kB gzip of the
 * entry, which is what pushed the entry over its ceiling.
 *
 * Nothing else on the board reaches for the composer: pins, badges and the card
 * comments context are cheap and stay eager, because a card renders its badge
 * on first paint. The composer only ever mounts after a deliberate gesture --
 * "comment on this card", or a click on empty board with the comment tool armed
 * -- which is exactly the point at which a fetch is free. `CanvasSurface` holds
 * the `lazy()` wrapper; import this module directly only from a test.
 */

import type { JSX } from 'react';
import { useCallback } from 'react';

import { CommentComposer } from '../editor/commenting/ui/CommentComposer';
import type { CommentMember } from '../editor/commenting/types';

import type { CanvasCommentTarget } from './canvasComments';

export interface CanvasCommentComposerProps {
  target: CanvasCommentTarget;
  /** What the thread will point at, in words. */
  targetLabel: string;
  getMembers(): CommentMember[];
  onSubmit(text: string, mentionedUserIds: string[]): void;
  onCancel(): void;
}

export function CanvasCommentComposer({
  target,
  targetLabel,
  getMembers,
  onSubmit,
  onCancel,
}: CanvasCommentComposerProps): JSX.Element {
  const submit = useCallback(
    (text: string, mentionedUserIds: string[]) => {
      onSubmit(text, mentionedUserIds);
    },
    [onSubmit]
  );

  return (
    <div
      className="canvas-comment-composer"
      data-canvas-comment-target={target.kind}
    >
      <div className="canvas-comment-composer__target">{targetLabel}</div>
      <CommentComposer
        className="canvas-comment-composer__field"
        getMembers={getMembers}
        onSubmit={submit}
        onCancel={onCancel}
        submitLabel="Comment"
        placeholder="Add a comment. Mention @agent to hand it to a session."
        label="New canvas comment"
        autoFocus
      />
    </div>
  );
}
