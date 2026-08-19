// @vitest-environment node
/**
 * Resolving an AI change must leave the document with NO diff marks --
 * otherwise the leftovers stack up turn after turn (#2612).
 *
 * Why this is collab-only: for a local file the `diff` NodeState lives only in
 * the in-memory Lexical state, and the next re-import from disk wipes it. In a
 * shared document that same NodeState is serialized into the Y.Doc, persisted
 * server-side and broadcast to every peer -- so a mark the accept/reject path
 * fails to clear survives reloads and every later turn adds more on top. That
 * the leak depends on WHICH button the user clicks is what made it look
 * intermittent: Keep All / Reject All walk the whole tree and were always
 * clean; the per-group Keep / Reject buttons were not.
 *
 * The marks that leak are the `'modified'` markers `DefaultDiffHandler` puts on
 * the container ABOVE a changed node. `groupDiffChanges` deliberately excludes
 * `'modified'` nodes from every group, so no group ever names them:
 *
 *  - paragraph  -- reject cleared the group's nodes but never walked up.
 *  - nested list -- two stacked containers (list > listitem); the outer one is
 *    only clearable once the inner one has gone, so order matters.
 *  - table cell -- produces ONLY container markers, so it yields ZERO groups
 *    and the per-group buttons cannot reach it at all; the approval bar has to
 *    sweep on its way out.
 */
import { describe, expect, it } from 'vitest';
import { $getRoot, $isElementNode, type LexicalNode } from 'lexical';
import { $convertFromEnhancedMarkdownString } from '../../../../markdown/index';
import { createTestHeadlessEditor, MARKDOWN_TEST_TRANSFORMERS } from '../utils/testConfig';
import { $getDiffState } from '../../core/DiffState';
import {
  applyMarkdownReplace,
  groupDiffChanges,
  $approveChangeGroup,
  $rejectChangeGroup,
  $approveDiffs,
  $rejectDiffs,
  $clearResidualDiffMarkers,
  $hasDiffNodes,
} from '../../core/exports';

type Editor = ReturnType<typeof createTestHeadlessEditor>;

/** Every node still carrying a diff mark, as "state:type:text" for readable failures. */
function markedNodes(editor: Editor): string[] {
  const marked: string[] = [];
  editor.getEditorState().read(() => {
    const walk = (node: LexicalNode) => {
      const state = $getDiffState(node);
      if (state) marked.push(`${state}:${node.getType()}:${node.getTextContent().slice(0, 24)}`);
      if ($isElementNode(node)) for (const child of node.getChildren()) walk(child);
    };
    for (const child of $getRoot().getChildren()) walk(child);
  });
  return marked;
}

/** Seed the document, then run one AI edit the way APPLY_MARKDOWN_REPLACE_COMMAND does. */
function seedAndEdit(editor: Editor, src: string, oldText: string, newText: string) {
  editor.update(
    () => {
      $getRoot().clear();
      $convertFromEnhancedMarkdownString(src, MARKDOWN_TEST_TRANSFORMERS);
    },
    { discrete: true },
  );
  applyMarkdownReplace(editor, src, [{ oldText, newText }], MARKDOWN_TEST_TRANSFORMERS);
}

const CASES = [
  {
    name: 'paragraph',
    src: '# Title\n\npara one\n\npara two\n',
    oldText: 'para one',
    newText: 'para one CHANGED',
  },
  {
    name: 'nested list',
    src: '- alpha\n- beta\n- gamma\n',
    oldText: '- beta',
    newText: '- beta CHANGED',
  },
  {
    name: 'table cell',
    src: '| a | b |\n| --- | --- |\n| 1 | 2 |\n',
    oldText: '| 1 | 2 |',
    newText: '| 1 | 999 |',
  },
] as const;

/**
 * The four ways a user can resolve a change. The per-group pair mirrors
 * `useLexicalDiffState`, which sweeps residual container markers once no
 * actionable group is left.
 */
const STRATEGIES = [
  {
    name: 'per-group approve',
    run: (e: Editor) => {
      for (const g of groupDiffChanges(e)) $approveChangeGroup(e, g.nodes);
      if (groupDiffChanges(e).length === 0) $clearResidualDiffMarkers(e);
    },
  },
  {
    name: 'per-group reject',
    run: (e: Editor) => {
      for (const g of groupDiffChanges(e)) $rejectChangeGroup(e, g.nodes);
      if (groupDiffChanges(e).length === 0) $clearResidualDiffMarkers(e);
    },
  },
  { name: 'approve all', run: (e: Editor) => e.update(() => $approveDiffs(), { discrete: true }) },
  { name: 'reject all', run: (e: Editor) => e.update(() => $rejectDiffs(), { discrete: true }) },
] as const;

describe('resolving a change clears every diff mark', () => {
  for (const testCase of CASES) {
    for (const strategy of STRATEGIES) {
      it(`${testCase.name} / ${strategy.name}`, () => {
        const editor = createTestHeadlessEditor();
        seedAndEdit(editor, testCase.src, testCase.oldText, testCase.newText);
        expect(markedNodes(editor).length).toBeGreaterThan(0);

        strategy.run(editor);

        expect(markedNodes(editor)).toEqual([]);
        expect($hasDiffNodes(editor)).toBe(false);
      });
    }
  }

  it('a table-cell edit is marked but yields no change group', () => {
    // Pins the reason the sweep has to exist: `$hasDiffNodes` is true (the bar
    // shows) while `groupDiffChanges` is empty (no group can clear it).
    const editor = createTestHeadlessEditor();
    seedAndEdit(editor, '| a | b |\n| --- | --- |\n| 1 | 2 |\n', '| 1 | 2 |', '| 1 | 999 |');

    expect($hasDiffNodes(editor)).toBe(true);
    expect(groupDiffChanges(editor)).toEqual([]);
  });
});
