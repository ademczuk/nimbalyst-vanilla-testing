// @vitest-environment node
/**
 * Applying an AI replacement must mark ONLY the region it changed.
 *
 * `applyMarkdownReplace` re-diffs the whole document: it exports the current
 * state to markdown, applies the text replacement, re-imports, and matches
 * the two trees. Anything the matcher fails to pair up gets marked, so a
 * document whose node structure differs from what a clean markdown import
 * would produce can over-mark untouched regions -- which reads to a user as
 * "all my previous changes came back".
 *
 * Shared documents are exactly that case: collaborative editing splits text
 * into multiple TextNodes (each concurrent insert can create its own), while
 * a local file re-imported from disk is always cleanly structured. That is a
 * candidate explanation for the bug being collab-only and intermittent.
 */
import { describe, expect, it } from 'vitest';
import { $getRoot, $isElementNode, type LexicalNode } from 'lexical';
import { $convertFromEnhancedMarkdownString } from '../../../../markdown/index';
import { createTestHeadlessEditor, MARKDOWN_TEST_TRANSFORMERS } from '../utils/testConfig';
import { $getDiffState } from '../../core/DiffState';
import { applyMarkdownReplace } from '../../core/exports';

const SOURCE = `# Title

para one

para two
`;

/** Every node carrying a diff mark, as "state:text" for readable failures. */
function markedNodes(editor: ReturnType<typeof createTestHeadlessEditor>): string[] {
  const marked: string[] = [];
  editor.getEditorState().read(() => {
    const walk = (node: LexicalNode) => {
      const state = $getDiffState(node);
      if (state) {
        marked.push(`${state}:${node.getTextContent().slice(0, 30)}`);
      }
      if ($isElementNode(node)) {
        for (const child of node.getChildren()) walk(child);
      }
    };
    for (const child of $getRoot().getChildren()) walk(child);
  });
  return marked;
}

function seed(editor: ReturnType<typeof createTestHeadlessEditor>) {
  editor.update(
    () => {
      $getRoot().clear();
      $convertFromEnhancedMarkdownString(SOURCE, MARKDOWN_TEST_TRANSFORMERS);
    },
    { discrete: true },
  );
}

/**
 * Split every text node in two, the way concurrent collaborative inserts
 * leave a paragraph. Content is unchanged; only the node structure differs.
 */
function fragmentTextNodes(editor: ReturnType<typeof createTestHeadlessEditor>) {
  editor.update(
    () => {
      const walk = (node: LexicalNode) => {
        if ($isElementNode(node)) {
          for (const child of node.getChildren()) walk(child);
          return;
        }
        const text = node.getTextContent();
        if (text.length > 2 && typeof (node as any).splitText === 'function') {
          (node as any).splitText(Math.floor(text.length / 2));
        }
      };
      for (const child of $getRoot().getChildren()) walk(child);
    },
    { discrete: true },
  );
}

function replaceParaTwo(editor: ReturnType<typeof createTestHeadlessEditor>) {
  const original = SOURCE;
  applyMarkdownReplace(
    editor,
    original,
    [{ oldText: 'para two', newText: 'para two edited' }] as any,
    MARKDOWN_TEST_TRANSFORMERS,
  );
}

describe('applyMarkdownReplace marking scope', () => {
  it('marks only the replaced region in a cleanly structured document', () => {
    const editor = createTestHeadlessEditor();
    seed(editor);
    replaceParaTwo(editor);

    const marked = markedNodes(editor);
    expect(marked.join(' | ')).not.toContain('para one');
    expect(marked.join(' | ')).not.toContain('Title');
  });

  it('marks only the replaced region when text nodes are fragmented', () => {
    // Same content, same replacement -- only the node structure differs.
    const editor = createTestHeadlessEditor();
    seed(editor);
    fragmentTextNodes(editor);
    replaceParaTwo(editor);

    const marked = markedNodes(editor);
    expect(marked.join(' | ')).not.toContain('para one');
    expect(marked.join(' | ')).not.toContain('Title');
  });
});
