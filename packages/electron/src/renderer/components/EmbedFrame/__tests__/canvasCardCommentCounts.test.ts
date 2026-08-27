// @vitest-environment node
/**
 * The in-document half of a card's dual comment count.
 *
 * The failure this guards is silent and specific: answering `0` for a card the
 * host has not actually looked at. Zero reads as "nobody has commented on that
 * document", the chrome renders it as a real badge state, and there is nothing
 * on screen to tell a reader the difference between "none" and "not connected".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

const peek = vi.fn();

vi.mock('../../../services/CollaborativeEmbedProviderCache', () => ({
  collaborativeEmbedProviderCache: {
    peek: (...args: unknown[]) => peek(...args),
  },
}));

const { canvasCardCommentCounts } = await import('../canvasCardCommentCounts');
const { YDocCommentRepository, createComment, createThread } = await import(
  '@nimbalyst/runtime/editor/commenting/YDocCommentRepository'
);

/** The canonical shape a `.canvas` file stores for a shared-document card. */
const DOC_CARD = {
  kind: 'doc' as const,
  uri: 'nimbalyst://doc/org-1/doc-9' as const,
};
const FILE_CARD = { kind: 'file' as const, path: 'docs/prd.md' };

function roomWithThreads(): Y.Doc {
  const yDoc = new Y.Doc();
  const repository = new YDocCommentRepository(yDoc);
  repository.addThread(
    createThread('open', [createComment('needs a number', 'Greg')]),
  );
  repository.addThread(
    createThread('settled', [createComment('done', 'Greg')], 't-resolved', true),
  );
  repository.addThread(
    createThread('gone', [
      createComment('oops', 'Greg', 'c-dead', 1, true),
    ]),
  );
  repository.destroy();
  return yDoc;
}

describe('canvas card in-document comment counts', () => {
  beforeEach(() => {
    canvasCardCommentCounts.reset();
    peek.mockReset();
  });

  it('reports unknown, not zero, for a room nobody has opened', () => {
    peek.mockReturnValue(null);
    const stop = canvasCardCommentCounts.watch([DOC_CARD], () => {});
    expect(canvasCardCommentCounts.getOpenThreadCount(DOC_CARD)).toBeNull();
    stop();
  });

  it('reports unknown for a file card, which has no comment room at all', () => {
    peek.mockReturnValue({ collaboration: { yDoc: new Y.Doc() } });
    const stop = canvasCardCommentCounts.watch([FILE_CARD], () => {});
    expect(canvasCardCommentCounts.getOpenThreadCount(FILE_CARD)).toBeNull();
    // A file card must not even be looked up: there is no document id to look
    // one up by, and matching on anything else would count another card's room.
    expect(peek).not.toHaveBeenCalled();
    stop();
  });

  it('counts only live unresolved threads in an open room', () => {
    peek.mockReturnValue({ collaboration: { yDoc: roomWithThreads() } });
    const onChange = vi.fn();
    const stop = canvasCardCommentCounts.watch([DOC_CARD], onChange);

    // One open thread: the resolved one is history, and the one whose only
    // comment was deleted is a tombstone that would send a reader nowhere.
    expect(canvasCardCommentCounts.getOpenThreadCount(DOC_CARD)).toBe(1);
    expect(onChange).toHaveBeenCalled();

    // Unwatching detaches, and the count goes back to unknown rather than to a
    // stale number from a board that is no longer open.
    stop();
    expect(canvasCardCommentCounts.getOpenThreadCount(DOC_CARD)).toBeNull();
  });
});
