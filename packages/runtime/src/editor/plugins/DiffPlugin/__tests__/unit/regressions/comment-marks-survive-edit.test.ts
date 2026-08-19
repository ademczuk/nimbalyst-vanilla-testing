// @vitest-environment node
/**
 * Comment anchors must survive an AI edit (#2644).
 *
 * Inline comment highlights are `@lexical/mark` MarkNodes. Markdown has no
 * syntax for them, so they exist only in the live document -- never in the
 * SOURCE or TARGET markdown the diff is computed from. Any node the diff
 * rebuilds from TARGET therefore comes back stripped, and the thread silently
 * loses its highlight.
 */
import { $isMarkNode, $wrapSelectionInMarkNode } from '@lexical/mark';
import {
  $createRangeSelection,
  $getRoot,
  $isTextNode,
  $setSelection,
  type LexicalEditor,
} from 'lexical';
import { describe, expect, it } from 'vitest';

import { createThread } from '../../../../../commenting';
import { reanchorOrphanedThreads } from '../../../../../commenting/reanchorOrphanedThreads';
import { $convertFromEnhancedMarkdownString } from '../../../../../markdown';
import { applyMarkdownReplace } from '../../../core/exports';
import {
  createTestHeadlessEditor,
  MARKDOWN_TEST_TRANSFORMERS,
} from '../../utils/testConfig';

const OLD_MARKDOWN = [
  '# Title',
  '',
  'First paragraph with anchored text.',
  '',
  'Second paragraph.',
  '',
].join('\n');

/** Wrap `phrase` wherever it occurs in the document in a comment MarkNode. */
function anchorComment(
  editor: LexicalEditor,
  phrase: string,
  id: string,
): void {
  editor.update(
    () => {
      const textNode = $getRoot()
        .getAllTextNodes()
        .find((node) => node.getTextContent().includes(phrase));
      if (!textNode) throw new Error(`no text node contains "${phrase}"`);
      const start = textNode.getTextContent().indexOf(phrase);

      const selection = $createRangeSelection();
      selection.anchor.set(textNode.getKey(), start, 'text');
      selection.focus.set(textNode.getKey(), start + phrase.length, 'text');
      $setSelection(selection);
      $wrapSelectionInMarkNode(selection, false, id);
      $setSelection(null);
    },
    { discrete: true },
  );
}

function collectMarks(editor: LexicalEditor): Array<{ ids: string[]; text: string }> {
  const marks: Array<{ ids: string[]; text: string }> = [];
  editor.getEditorState().read(() => {
    const visit = (node: any) => {
      if ($isMarkNode(node)) {
        marks.push({ ids: node.getIDs(), text: node.getTextContent() });
      }
      if (!$isTextNode(node) && typeof node.getChildren === 'function') {
        for (const child of node.getChildren()) visit(child);
      }
    };
    visit($getRoot());
  });
  return marks;
}

describe('comment marks survive an AI edit', () => {
  it('keeps an anchor in a paragraph the edit does not touch', () => {
    const editor = createTestHeadlessEditor();
    editor.update(
      () => {
        $getRoot().clear();
        $convertFromEnhancedMarkdownString(
          OLD_MARKDOWN,
          MARKDOWN_TEST_TRANSFORMERS,
        );
      },
      { discrete: true },
    );
    anchorComment(editor, 'anchored text', 'thread-1');
    expect(collectMarks(editor)).toHaveLength(1);

    editor.update(
      () => {
        applyMarkdownReplace(
          editor,
          OLD_MARKDOWN,
          [{ oldText: 'Second paragraph.', newText: 'Second paragraph, revised.' }],
          MARKDOWN_TEST_TRANSFORMERS,
        );
      },
      { discrete: true },
    );

    expect(collectMarks(editor)).toEqual([
      { ids: ['thread-1'], text: 'anchored text' },
    ]);
  });

  it('keeps an anchor when its own paragraph is edited around it', () => {
    const editor = createTestHeadlessEditor();
    editor.update(
      () => {
        $getRoot().clear();
        $convertFromEnhancedMarkdownString(
          OLD_MARKDOWN,
          MARKDOWN_TEST_TRANSFORMERS,
        );
      },
      { discrete: true },
    );
    anchorComment(editor, 'anchored text', 'thread-1');

    editor.update(
      () => {
        applyMarkdownReplace(
          editor,
          OLD_MARKDOWN,
          [
            {
              oldText: 'First paragraph with anchored text.',
              newText: 'First revised paragraph with anchored text.',
            },
          ],
          MARKDOWN_TEST_TRANSFORMERS,
        );
      },
      { discrete: true },
    );

    expect(collectMarks(editor)).toEqual([
      { ids: ['thread-1'], text: 'anchored text' },
    ]);
  });

  it('recovers anchors a full-document reload destroys', () => {
    // The edit path above is anchor-safe; a whole-document reload is not.
    // Reverting to disk content, applying a pending edit on mount, and the
    // other `root.clear()` + reparse paths throw away every node, so marks die
    // document-wide even where the text is untouched. Nothing can survive that
    // rebuild -- the anchors have to be laid back down afterwards.
    const editor = createTestHeadlessEditor();
    editor.update(
      () => {
        $getRoot().clear();
        $convertFromEnhancedMarkdownString(
          OLD_MARKDOWN,
          MARKDOWN_TEST_TRANSFORMERS,
        );
      },
      { discrete: true },
    );
    anchorComment(editor, 'anchored text', 'thread-1');

    editor.update(
      () => {
        $setSelection(null);
        $getRoot().clear();
        $convertFromEnhancedMarkdownString(
          OLD_MARKDOWN,
          MARKDOWN_TEST_TRANSFORMERS,
        );
      },
      { discrete: true },
    );
    expect(collectMarks(editor)).toEqual([]);

    const thread = createThread('anchored text', [], 'thread-1');
    const result = reanchorOrphanedThreads(editor, [thread]);

    expect(result.reattached).toEqual(['thread-1']);
    expect(collectMarks(editor)).toEqual([
      { ids: ['thread-1'], text: 'anchored text' },
    ]);
  });
});
