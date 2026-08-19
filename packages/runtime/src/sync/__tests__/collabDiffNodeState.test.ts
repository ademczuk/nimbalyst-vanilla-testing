// @vitest-environment node
/**
 * Red/green diff marks in a SHARED document are Lexical NodeState (`diff`),
 * not decorations -- so they live in the Y.Doc and travel to every peer.
 * Accepting or rejecting a change clears that state; if the clear does not
 * make the round trip, the mark survives in the shared doc and reappears on
 * the next repaint, which is what "already accepted changes come back"
 * looks like to a user (LC-1 / bug_1786132409131_xf8qds).
 *
 * The suspected culprit is the `prevState === nextState` early-out in
 * @lexical/yjs `syncNodeStateFromLexical`: when Lexical reuses the NodeState
 * object across an update, the whole state sync is skipped. That is timing
 * dependent, which matches the bug being hard to reproduce by hand.
 *
 * These tests pin the round trip in both directions for a two-peer setup.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createHeadlessEditor } from '@lexical/headless';
import {
  createBinding,
  syncLexicalUpdateToYjs,
  syncYjsChangesToLexical,
} from '@lexical/yjs';
import { $getRoot, $createParagraphNode, $createTextNode, type LexicalEditor } from 'lexical';
import {
  $setDiffState,
  $clearDiffState,
  $getDiffState,
} from '../../editor/plugins/DiffPlugin/core/DiffState';
import {
  $approveChangeGroup,
  $rejectChangeGroup,
} from '../../editor/plugins/DiffPlugin/core/diffPluginUtils';

const bindingProvider = {
  awareness: {
    getLocalState: () => null,
    setLocalState: () => {},
    getStates: () => new Map(),
    on: () => {},
    off: () => {},
  },
} as any;

function makePeer(namespace: string) {
  const doc = new Y.Doc();
  const editor = createHeadlessEditor({
    namespace,
    nodes: [],
    onError: (e) => {
      throw e;
    },
  });
  const docMap = new Map<string, Y.Doc>([['main', doc]]);
  const binding = createBinding(editor, bindingProvider, 'main', doc, docMap);

  binding.root.getSharedType().observeDeep((events: any, transaction: any) => {
    if (transaction.origin !== binding) {
      syncYjsChangesToLexical(binding, bindingProvider, events, false, () => {});
    }
  });

  editor.registerUpdateListener(
    ({ prevEditorState, editorState, dirtyLeaves, dirtyElements, normalizedNodes, tags }) => {
      syncLexicalUpdateToYjs(
        binding,
        bindingProvider,
        prevEditorState,
        editorState,
        dirtyElements,
        dirtyLeaves,
        normalizedNodes,
        tags,
      );
    },
  );

  // Walk the collab tree into real Lexical nodes. Building the tree via the
  // deep observer is NOT enough on its own -- see HeadlessLexicalYDoc.
  const hydrate = () => {
    editor.update(
      () => {
        binding.root.syncChildrenFromYjs(binding);
      },
      { discrete: true },
    );
  };

  return { doc, editor, binding, hydrate };
}

type Peer = ReturnType<typeof makePeer>;

/** Wire two peers so every local Y update is replayed into the other doc. */
function connect(a: Peer, b: Peer) {
  const REMOTE = 'remote';
  a.doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== REMOTE) {
      Y.applyUpdate(b.doc, update, REMOTE);
      b.hydrate();
    }
  });
  b.doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== REMOTE) {
      Y.applyUpdate(a.doc, update, REMOTE);
      a.hydrate();
    }
  });
}

function readText(editor: LexicalEditor): string {
  let text = '';
  editor.getEditorState().read(() => {
    text = $getRoot().getTextContent();
  });
  return text;
}

/** Diff state of the first paragraph, as that peer currently sees it. */
function readDiff(editor: LexicalEditor): string | null {
  let state: string | null = null;
  editor.getEditorState().read(() => {
    const first = $getRoot().getFirstChild();
    state = first ? $getDiffState(first) : null;
  });
  return state;
}

function seedParagraph(editor: LexicalEditor, text: string) {
  editor.update(
    () => {
      const paragraph = $createParagraphNode();
      paragraph.append($createTextNode(text));
      $getRoot().append(paragraph);
    },
    { discrete: true },
  );
}

function updateFirstChild(editor: LexicalEditor, fn: (node: any) => void) {
  editor.update(
    () => {
      const first = $getRoot().getFirstChild();
      if (first) fn(first);
    },
    { discrete: true },
  );
}

describe('diff NodeState round-trips through the collab binding', () => {
  it('carries a set diff mark to the other peer, then clears it there', () => {
    const author = makePeer('diff-author');
    const reader = makePeer('diff-reader');
    connect(author, reader);

    seedParagraph(author.editor, 'hello');
    // Sanity: if this fails the binding itself is broken and the diff-state
    // assertions below would be misleading.
    expect(readText(reader.editor)).toBe('hello');
    expect(readDiff(reader.editor)).toBeNull();

    // The agent marks the paragraph as an addition.
    updateFirstChild(author.editor, (node) => $setDiffState(node, 'added'));
    expect(readDiff(author.editor)).toBe('added');
    expect(readDiff(reader.editor)).toBe('added');

    // The user accepts. The mark must disappear for BOTH peers -- if it
    // survives in the shared doc it comes back on the next repaint.
    updateFirstChild(author.editor, (node) => $clearDiffState(node));
    expect(readDiff(author.editor)).toBeNull();
    expect(readDiff(reader.editor)).toBeNull();
  });

  it('clears a mark that was set in the same update as the node itself', () => {
    // Codex-style: the node and its diff mark land together, so the node has
    // no previous version carrying state. Accepting still has to clear it.
    const author = makePeer('diff-author-2');
    const reader = makePeer('diff-reader-2');
    connect(author, reader);

    author.editor.update(
      () => {
        const paragraph = $createParagraphNode();
        paragraph.append($createTextNode('new line'));
        $setDiffState(paragraph, 'added');
        $getRoot().append(paragraph);
      },
      { discrete: true },
    );
    expect(readDiff(reader.editor)).toBe('added');

    updateFirstChild(author.editor, (node) => $clearDiffState(node));
    expect(readDiff(reader.editor)).toBeNull();
  });

  it('survives a cold reader binding to the doc after the clear', () => {
    // The repaint path: a peer that joins (or remounts) after the accept must
    // hydrate a clean document, not one still carrying the old mark.
    const author = makePeer('diff-author-3');
    seedParagraph(author.editor, 'hello');
    updateFirstChild(author.editor, (node) => $setDiffState(node, 'modified'));
    updateFirstChild(author.editor, (node) => $clearDiffState(node));

    const cold = makePeer('diff-cold');
    Y.applyUpdate(cold.doc, Y.encodeStateAsUpdate(author.doc), 'remote');
    cold.hydrate();

    expect(readText(cold.editor)).toBe('hello');
    expect(readDiff(cold.editor)).toBeNull();
  });

  it('clears the mark for peers when accepted through the real approve path', () => {
    // $approveChangeGroup is what the Keep / Keep All buttons run. It clears
    // the node AND walks up clearing parents, which is a different write
    // shape from a single $clearDiffState.
    const author = makePeer('diff-approve-author');
    const reader = makePeer('diff-approve-reader');
    connect(author, reader);

    seedParagraph(author.editor, 'accepted line');
    updateFirstChild(author.editor, (node) => $setDiffState(node, 'added'));
    expect(readDiff(reader.editor)).toBe('added');

    let target: any = null;
    author.editor.getEditorState().read(() => {
      target = $getRoot().getFirstChild();
    });
    $approveChangeGroup(author.editor, [target]);

    expect(readDiff(author.editor)).toBeNull();
    expect(readDiff(reader.editor)).toBeNull();
    expect(readText(reader.editor)).toBe('accepted line');
  });

  it('removes rejected content for peers through the real reject path', () => {
    // 'added' + reject means the node goes away entirely; the deletion has to
    // reach peers, not just clear the mark locally.
    const author = makePeer('diff-reject-author');
    const reader = makePeer('diff-reject-reader');
    connect(author, reader);

    seedParagraph(author.editor, 'keep me');
    author.editor.update(
      () => {
        const paragraph = $createParagraphNode();
        paragraph.append($createTextNode('reject me'));
        $setDiffState(paragraph, 'added');
        $getRoot().append(paragraph);
      },
      { discrete: true },
    );
    expect(readText(reader.editor)).toContain('reject me');

    let target: any = null;
    author.editor.getEditorState().read(() => {
      target = $getRoot().getLastChild();
    });
    $rejectChangeGroup(author.editor, [target]);

    expect(readText(author.editor)).not.toContain('reject me');
    expect(readText(reader.editor)).not.toContain('reject me');
  });
});
