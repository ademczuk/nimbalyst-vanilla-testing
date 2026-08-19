// @vitest-environment node
/**
 * `applyExternalMarkdown` replaces editor content without remounting.
 *
 * Two things can silently regress here and neither is visible on screen until
 * a user loses work:
 *   - the replacement quietly falling back to vanilla `@lexical/markdown`,
 *     which drops frontmatter and flattens list indentation
 *   - the caret snapping to the top of the document when a collaborator edits
 *     above it, which is the whole reason this path exists instead of a remount
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createHeadlessEditor } from '@lexical/headless';
import { $getRoot, $getSelection, $isRangeSelection, type LexicalEditor } from 'lexical';
import { ListNode, ListItemNode } from '@lexical/list';

import HeadlessBodyNodes from '../nodes/headlessBodyNodes';
// Side-effect: populates the transformer set (core + built-in extensions) so
// getEditorTransformers() returns what a real renderer editor uses.
import '../extensions/registerBuiltinExtensions';
import { getEditorTransformers } from '../markdown';
import { $convertFromEnhancedMarkdownString } from '../markdown/EnhancedMarkdownImport';
import { $getFrontmatter } from '../markdown/FrontmatterUtils';
import { applyExternalMarkdown, mapOffsetAcrossChange } from '../applyExternalMarkdown';

function createEditor(): LexicalEditor {
  return createHeadlessEditor({
    namespace: 'apply-external-markdown-test',
    nodes: [...HeadlessBodyNodes],
    onError: (error: Error) => {
      throw error;
    },
  });
}

function seed(editor: LexicalEditor, markdown: string): void {
  editor.update(
    () => {
      $getRoot().clear();
      $convertFromEnhancedMarkdownString(markdown, getEditorTransformers());
    },
    { discrete: true }
  );
}

/** Put the caret inside the text node whose content matches `text`. */
function placeCaret(editor: LexicalEditor, text: string, offset: number): void {
  editor.update(
    () => {
      const node = $getRoot()
        .getAllTextNodes()
        .find((candidate) => candidate.getTextContent() === text);
      if (!node) throw new Error(`No text node with content "${text}"`);
      node.select(offset, offset);
    },
    { discrete: true }
  );
}

function readCaret(editor: LexicalEditor): { text: string; offset: number } | null {
  return editor.getEditorState().read(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return null;
    return {
      text: selection.anchor.getNode().getTextContent(),
      offset: selection.anchor.offset,
    };
  });
}

describe('applyExternalMarkdown', () => {
  let editor: LexicalEditor;

  beforeEach(() => {
    editor = createEditor();
  });

  it('replaces content through the enhanced converters, keeping frontmatter and list nesting', async () => {
    seed(editor, 'placeholder');

    applyExternalMarkdown(
      editor,
      ['---', 'title: Deck', 'theme: executive', '---', '', '- top', '  - nested', ''].join('\n')
    );
    await Promise.resolve();

    const result = editor.getEditorState().read(() => {
      // Vanilla @lexical/markdown has no concept of frontmatter -- it would
      // parse the `---` fences as a horizontal rule and leave this null.
      const frontmatter = $getFrontmatter();
      const lists = $getRoot()
        .getChildren()
        .filter((node): node is ListNode => node instanceof ListNode);
      const nestedDepths = lists.flatMap((list) =>
        list
          .getChildren()
          .filter((item): item is ListItemNode => item instanceof ListItemNode)
          .flatMap((item) =>
            item
              .getChildren()
              .filter((child): child is ListNode => child instanceof ListNode)
              .map((sublist) => sublist.getChildrenSize())
          )
      );
      return { frontmatter, listCount: lists.length, nestedDepths };
    });

    expect(result.frontmatter).toEqual({ title: 'Deck', theme: 'executive' });
    expect(result.listCount).toBe(1);
    // The nested bullet survived as a child list, not as flattened text.
    expect(result.nestedDepths).toEqual([1]);
  });

  it('keeps the caret on the same character when a remote edit lands above it', async () => {
    seed(editor, 'alpha\n\nbravo');
    placeCaret(editor, 'bravo', 3);
    expect(readCaret(editor)).toEqual({ text: 'bravo', offset: 3 });

    // A collaborator inserts a paragraph above the one being edited.
    applyExternalMarkdown(editor, 'intro\n\nalpha\n\nbravo');
    await Promise.resolve();

    expect(readCaret(editor)).toEqual({ text: 'bravo', offset: 3 });
  });

  it('keeps the caret when a remote edit lands below it', async () => {
    seed(editor, 'alpha\n\nbravo');
    placeCaret(editor, 'alpha', 2);

    applyExternalMarkdown(editor, 'alpha\n\nbravo\n\ncharlie');
    await Promise.resolve();

    expect(readCaret(editor)).toEqual({ text: 'alpha', offset: 2 });
  });

  it('keeps the caret in its paragraph across disjoint edits above and below it', async () => {
    seed(editor, 'alpha\n\nmiddle\n\nfooter');
    placeCaret(editor, 'middle', 3);

    applyExternalMarkdown(editor, '# intro\n\nalpha\n\nmiddle\n\nrevised footer');
    await Promise.resolve();

    expect(readCaret(editor)).toEqual({ text: 'middle', offset: 3 });
  });
});

describe('mapOffsetAcrossChange', () => {
  it('shifts offsets after an insertion, holds offsets before it, clamps inside it', () => {
    // "abcXYZdef" <- "XYZ" inserted at 3
    expect(mapOffsetAcrossChange('abcdef', 'abcXYZdef', 2)).toBe(2);
    expect(mapOffsetAcrossChange('abcdef', 'abcXYZdef', 5)).toBe(8);
    // "abcdef" -> "abQQef": the caret sat inside the replaced span.
    expect(mapOffsetAcrossChange('abcdef', 'abQQef', 3)).toBe(3);
    expect(mapOffsetAcrossChange('abcdef', 'abQQef', 4)).toBe(4);
  });

  it('maps through separate edits on both sides of the offset', () => {
    const before = 'alpha\nmiddle\nfooter';
    const after = 'intro\nalpha\nmiddle\nrevised footer';
    const caret = before.indexOf('middle') + 3;

    expect(mapOffsetAcrossChange(before, after, caret)).toBe(after.indexOf('middle') + 3);
  });
});
