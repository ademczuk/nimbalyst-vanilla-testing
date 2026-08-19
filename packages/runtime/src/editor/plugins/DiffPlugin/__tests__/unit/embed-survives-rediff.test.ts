// @vitest-environment node
/**
 * An AI edit near an embedded @ mention must not clone the embed (#1744).
 *
 * `applyMarkdownReplace` diffs a SOURCE clone of the live tree against a
 * TARGET tree re-imported from markdown. `EmbeddedFileNode` has no markdown
 * IMPORT transformer -- it is produced by a `registerNodeTransform` on
 * `LinkNode` that only `EmbedExtension` installs. The headless TARGET editor
 * runs no extensions, so the same markdown comes back as a plain `LinkNode`:
 * SOURCE has an embed where TARGET has a link, TreeMatcher cannot pair them,
 * and the recursion emits the embed twice with red/green marks.
 *
 * This is the same structural-mismatch class that `$editorHasAutoLinks` /
 * `$applyAutoLinksToHeadlessEditor` already handle for AutoLinkNode.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { $getRoot, $isElementNode, $createParagraphNode, $createTextNode, type LexicalNode } from 'lexical';
import { $isLinkNode } from '@lexical/link';
import { createTestHeadlessEditor, MARKDOWN_TEST_TRANSFORMERS } from '../utils/testConfig';
import { applyMarkdownReplace } from '../../core/exports';
import {
  $createEmbeddedFileNode,
  $isEmbeddedFileNode,
  EmbeddedFileNode,
} from '../../../EmbedPlugin/EmbeddedFileNode';
import { setEmbeddableExtensions } from '../../../EmbedPlugin/embeddableExtensions';

type Editor = ReturnType<typeof createTestHeadlessEditor>;

const SRC = 'notes/diagram.excalidraw';

function countNodes(editor: Editor) {
  let embeds = 0;
  let links = 0;
  editor.getEditorState().read(() => {
    const walk = (node: LexicalNode) => {
      if ($isEmbeddedFileNode(node)) embeds++;
      if ($isLinkNode(node)) links++;
      if ($isElementNode(node)) for (const child of node.getChildren()) walk(child);
    };
    for (const child of $getRoot().getChildren()) walk(child);
  });
  return { embeds, links };
}

afterEach(() => setEmbeddableExtensions([]));

describe('embedded mention survives a whole-document re-diff', () => {
  it('keeps exactly one embed when nearby text changes', () => {
    setEmbeddableExtensions(['.excalidraw']);
    const editor = createTestHeadlessEditor({ nodes: [EmbeddedFileNode] });

    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        const before = $createParagraphNode();
        before.append($createTextNode('intro text'));
        const after = $createParagraphNode();
        after.append($createTextNode('outro text'));
        root.append(before, $createEmbeddedFileNode({ src: SRC, label: SRC }), after);
      },
      { discrete: true },
    );

    expect(countNodes(editor)).toEqual({ embeds: 1, links: 0 });

    const original = `intro text\n\n[${SRC}](${SRC})\n\noutro text\n`;
    applyMarkdownReplace(
      editor,
      original,
      [{ oldText: 'intro text', newText: 'intro text CHANGED' }],
      MARKDOWN_TEST_TRANSFORMERS,
    );

    // The embed is untouched by the replacement, so it must still be a single
    // EmbeddedFileNode -- not duplicated, and not downgraded to a raw link.
    expect(countNodes(editor)).toEqual({ embeds: 1, links: 0 });
  });
});
