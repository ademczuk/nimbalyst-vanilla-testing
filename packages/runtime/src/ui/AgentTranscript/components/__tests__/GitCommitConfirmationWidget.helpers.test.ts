// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  compareFilesByBasename,
  compareSubdirectoriesByDisplayPath,
  type DirectoryNode,
} from '../CustomToolWidgets/GitCommitConfirmationWidget';
import { parseUnifiedDiffToHunks } from '../../../git/unifiedDiffModel';
import {
  buildFileHunkState,
  buildHunkSelections,
  buildSessionEditSignature,
  directoryCheckboxState,
  effectiveStagedFiles,
  fileCheckboxState,
  withAllHunksSelected,
  withHunkToggled,
} from '../CustomToolWidgets/gitCommit/selectionModel';

function makeNode(displayPath: string): DirectoryNode {
  return {
    path: displayPath,
    displayPath,
    files: [],
    subdirectories: new Map(),
    fileCount: 0,
  };
}

describe('compareFilesByBasename', () => {
  it('sorts paths alphabetically by their basename (issue #233 example)', () => {
    const modelOrder = [
      '.claude/commands/analyze-code.md',
      '.claude/commands/roadmap.md',
      '.claude/commands/bug-report.md',
      '.claude/commands/design.md',
      '.claude/commands/posthog-analysis.md',
    ];
    expect(modelOrder.slice().sort(compareFilesByBasename)).toEqual([
      '.claude/commands/analyze-code.md',
      '.claude/commands/bug-report.md',
      '.claude/commands/design.md',
      '.claude/commands/posthog-analysis.md',
      '.claude/commands/roadmap.md',
    ]);
  });

  it('sorts by basename only, not by full path', () => {
    const files = [
      'deep/nested/path/zebra.ts',
      'shallow/apple.ts',
    ];
    expect(files.slice().sort(compareFilesByBasename)).toEqual([
      'shallow/apple.ts',
      'deep/nested/path/zebra.ts',
    ]);
  });

  it('handles paths without directory separators', () => {
    const files = ['z.md', 'a.md', 'm.md'];
    expect(files.slice().sort(compareFilesByBasename)).toEqual(['a.md', 'm.md', 'z.md']);
  });

  it('sorts Windows paths by basename', () => {
    const files = ['deep\\zebra.ts', 'shallow\\apple.ts'];
    expect(files.slice().sort(compareFilesByBasename)).toEqual([
      'shallow\\apple.ts',
      'deep\\zebra.ts',
    ]);
  });

  it('is stable across already-sorted input', () => {
    const files = ['a.md', 'b.md', 'c.md'];
    expect(files.slice().sort(compareFilesByBasename)).toEqual(['a.md', 'b.md', 'c.md']);
  });
});

describe('compareSubdirectoriesByDisplayPath', () => {
  it('sorts nodes alphabetically by displayPath', () => {
    const nodes = [makeNode('utils'), makeNode('api'), makeNode('components')];
    expect(
      nodes
        .slice()
        .sort(compareSubdirectoriesByDisplayPath)
        .map((n) => n.displayPath),
    ).toEqual(['api', 'components', 'utils']);
  });

  it('handles collapsed compound displayPaths', () => {
    const nodes = [
      makeNode('packages/runtime/src'),
      makeNode('packages/electron/src/components'),
      makeNode('docs'),
    ];
    expect(
      nodes
        .slice()
        .sort(compareSubdirectoriesByDisplayPath)
        .map((n) => n.displayPath),
    ).toEqual([
      'docs',
      'packages/electron/src/components',
      'packages/runtime/src',
    ]);
  });
});

// --- hunk selection ------------------------------------------------------

const TWO_HUNKS = [
  'diff --git a/shared.txt b/shared.txt',
  'index 1111111..2222222 100644',
  '--- a/shared.txt',
  '+++ b/shared.txt',
  '@@ -2,5 +2,5 @@',
  ' line2',
  ' line3',
  ' line4',
  '-line5',
  '+SESSION-A',
  ' line6',
  '@@ -22,5 +22,5 @@',
  ' line22',
  ' line23',
  ' line24',
  '-line25',
  '+SESSION-B',
  ' line26',
].join('\n') + '\n';

const parsedTwoHunks = () => parseUnifiedDiffToHunks(TWO_HUNKS);

/** The session wrote only the first hunk's line. */
const sigA = { added: new Set(['SESSION-A']), removed: new Set(['line5']) };
/** The session wrote both hunks. */
const sigBoth = {
  added: new Set(['SESSION-A', 'SESSION-B']),
  removed: new Set(['line5', 'line25']),
};

describe('buildFileHunkState', () => {
  it('checks every hunk when the session cannot be attributed', () => {
    const state = buildFileHunkState(parsedTwoHunks(), null);
    expect(state.selected).toEqual(new Set([0, 1]));
    expect(state.sessionOwned.size).toBe(0);
  });

  it('checks only the session\'s hunks when it owns a strict subset', () => {
    const state = buildFileHunkState(parsedTwoHunks(), sigA);
    expect(state.sessionOwned).toEqual(new Set([0]));
    expect(state.selected).toEqual(new Set([0]));
  });

  it('falls back to checking everything when the session owns every hunk', () => {
    const state = buildFileHunkState(parsedTwoHunks(), sigBoth);
    expect(state.selected).toEqual(new Set([0, 1]));
  });

  it('attributes by line text, so a sibling write that shifts line numbers does not confuse it', () => {
    // Same two edits, but a sibling inserted 40 lines above, moving both hunks
    // far down. A range-based comparison against the session's own baseline
    // would attribute the wrong hunk (or neither); the text does not move.
    const shifted = parseUnifiedDiffToHunks(
      TWO_HUNKS.replace('@@ -2,5 +2,5 @@', '@@ -2,5 +42,5 @@').replace(
        '@@ -22,5 +22,5 @@',
        '@@ -22,5 +62,5 @@'
      )
    );
    const state = buildFileHunkState(shifted, sigA);
    expect(state.sessionOwned).toEqual(new Set([0]));
  });

  it('ignores trivial lines so whitespace cannot attribute a hunk', () => {
    const state = buildFileHunkState(parsedTwoHunks(), {
      added: new Set(['  ']),
      removed: new Set(['']),
    });
    expect(state.sessionOwned.size).toBe(0);
    expect(state.selected).toEqual(new Set([0, 1]));
  });

  it('refuses selection for a file with no HEAD blob', () => {
    const added = parseUnifiedDiffToHunks(
      ['diff --git a/n.txt b/n.txt', 'new file mode 100644', '--- /dev/null', '+++ b/n.txt', '@@ -0,0 +1 @@', '+a'].join('\n') + '\n'
    );
    expect(buildFileHunkState(added, sigA).selectable).toBe(false);
  });
});

describe('buildSessionEditSignature', () => {
  it('collects the distinctive lines the session added and removed', () => {
    const signature = buildSessionEditSignature(parsedTwoHunks());
    expect(signature.added).toEqual(new Set(['SESSION-A', 'SESSION-B']));
    expect(signature.removed).toEqual(new Set(['line5', 'line25']));
    // Context lines are not the session's edits.
    expect(signature.added.has('line6')).toBe(false);
  });
});

describe('fileCheckboxState', () => {
  const files = new Set(['shared.txt']);

  it('is all when the file has no hunk refinement', () => {
    expect(fileCheckboxState('shared.txt', files, new Map())).toBe('all');
  });

  it('is partial when a strict subset of hunks is checked', () => {
    const state = buildFileHunkState(parsedTwoHunks(), sigA);
    expect(fileCheckboxState('shared.txt', files, new Map([['shared.txt', state]]))).toBe('partial');
  });

  it('is none when the file is not staged at all', () => {
    expect(fileCheckboxState('shared.txt', new Set(), new Map())).toBe('none');
  });

  it('is none when every hunk was unchecked', () => {
    const state = buildFileHunkState(parsedTwoHunks(), null);
    const emptied = { ...state, selected: new Set<number>() };
    expect(fileCheckboxState('shared.txt', files, new Map([['shared.txt', emptied]]))).toBe('none');
  });
});

describe('buildHunkSelections', () => {
  const files = new Set(['shared.txt']);

  it('emits refs only for a strict subset', () => {
    const state = buildFileHunkState(parsedTwoHunks(), sigA);
    const payload = buildHunkSelections(files, new Map([['shared.txt', state]]));
    expect(payload).toEqual([
      { path: 'shared.txt', hunks: [{ oldStart: 2, oldLines: 5, newStart: 2, newLines: 5 }] },
    ]);
  });

  it('omits a fully selected file so it stages whole', () => {
    const state = buildFileHunkState(parsedTwoHunks(), null);
    expect(buildHunkSelections(files, new Map([['shared.txt', state]]))).toEqual([]);
  });

  it('omits a file with nothing checked, which drops out of the commit instead', () => {
    const state = buildFileHunkState(parsedTwoHunks(), null);
    const emptied = { ...state, selected: new Set<number>() };
    const states = new Map([['shared.txt', emptied]]);
    expect(buildHunkSelections(files, states)).toEqual([]);
    expect(effectiveStagedFiles(files, states)).toEqual([]);
  });
});

describe('directoryCheckboxState', () => {
  it('reports partial when one child file is partially selected', () => {
    const state = buildFileHunkState(parsedTwoHunks(), sigA);
    const result = directoryCheckboxState(
      ['shared.txt', 'other.txt'],
      new Set(['shared.txt', 'other.txt']),
      new Map([['shared.txt', state]])
    );
    expect(result).toBe('partial');
  });

  it('reports all when every child is whole', () => {
    expect(
      directoryCheckboxState(['a.txt', 'b.txt'], new Set(['a.txt', 'b.txt']), new Map())
    ).toBe('all');
  });
});

describe('withHunkToggled / withAllHunksSelected', () => {
  it('toggles one hunk without disturbing the others', () => {
    const states = new Map([['shared.txt', buildFileHunkState(parsedTwoHunks(), null)]]);
    const next = withHunkToggled(states, 'shared.txt', 1);
    expect(next.get('shared.txt')!.selected).toEqual(new Set([0]));
    expect(states.get('shared.txt')!.selected).toEqual(new Set([0, 1]));
  });

  it('restores the full selection', () => {
    const narrowed = new Map([
      ['shared.txt', buildFileHunkState(parsedTwoHunks(), sigA)],
    ]);
    expect(withAllHunksSelected(narrowed, 'shared.txt').get('shared.txt')!.selected).toEqual(
      new Set([0, 1])
    );
  });
});
