// Runs under the node environment; routed by path in vitest.config.ts, which
// this repo uses instead of the (vitest-4-removed) environmentMatchGlobs.
import { describe, expect, it } from 'vitest';
import {
  filterPatchToHunks,
  matchHunkRefs,
  parseUnifiedDiffToHunks,
  supportsHunkSelection,
  type HunkRef,
} from '../unifiedDiffModel';

/**
 * Fixtures are verbatim `git diff HEAD` output, captured from a real repo and
 * written as line arrays so a trailing-whitespace-stripping editor cannot
 * quietly corrupt an empty context line (which git emits as a single space).
 *
 * The renumbering these tests pin down was verified end-to-end against
 * `git apply --cached`; the round trip lives in GitCommitService.test.ts.
 */
const lines = (...l: string[]) => `${l.join('\n')}\n`;

/** Three hunks: net +2, net 0, net -1. */
const THREE_HUNKS = lines(
  'diff --git a/f.txt b/f.txt',
  'index 19339a3..9466469 100644',
  '--- a/f.txt',
  '+++ b/f.txt',
  '@@ -1,5 +1,7 @@',
  ' line1',
  ' line2',
  '+NEW-A',
  '+NEW-B',
  ' line3',
  ' line4',
  ' line5',
  '@@ -9,7 +11,7 @@ line8',
  ' line9',
  ' line10',
  ' line11',
  '-line12',
  '+CHANGED12',
  ' line13',
  ' line14',
  ' line15',
  '@@ -22,7 +24,6 @@ line21',
  ' line22',
  ' line23',
  ' line24',
  '-line25',
  ' line26',
  ' line27',
  ' line28',
);

const NO_NEWLINE_EOF = lines(
  'diff --git a/g.txt b/g.txt',
  'index 85c3040..8782f52 100644',
  '--- a/g.txt',
  '+++ b/g.txt',
  '@@ -1,3 +1,3 @@',
  ' alpha',
  ' beta',
  '-gamma',
  '+GAMMA',
  '\\ No newline at end of file',
);

const EMPTY_CONTEXT_LINE = lines(
  'diff --git a/h.txt b/h.txt',
  'index bda3f38..48ab57c 100644',
  '--- a/h.txt',
  '+++ b/h.txt',
  '@@ -1,5 +1,5 @@',
  ' a',
  ' ',
  '-b',
  '+B-CHANGED',
  ' ',
  ' c',
);

describe('parseUnifiedDiffToHunks', () => {
  it('splits a multi-hunk diff into hunks carrying their header tuple and section', () => {
    const parsed = parseUnifiedDiffToHunks(THREE_HUNKS);

    expect(parsed.headerLines).toEqual([
      'diff --git a/f.txt b/f.txt',
      'index 19339a3..9466469 100644',
      '--- a/f.txt',
      '+++ b/f.txt',
    ]);
    expect(parsed.hunks.map((h) => [h.oldStart, h.oldLines, h.newStart, h.newLines])).toEqual([
      [1, 5, 1, 7],
      [9, 7, 11, 7],
      [22, 7, 24, 6],
    ]);
    expect(parsed.hunks[1].section).toBe(' line8');
    expect(parsed.hunks[0].lines).toHaveLength(7);
  });

  it('keeps the no-newline marker with the hunk it belongs to', () => {
    const parsed = parseUnifiedDiffToHunks(NO_NEWLINE_EOF);
    expect(parsed.hunks).toHaveLength(1);
    expect(parsed.hunks[0].lines).toContain('\\ No newline at end of file');
  });

  it('does not lose an empty context line', () => {
    const parsed = parseUnifiedDiffToHunks(EMPTY_CONTEXT_LINE);
    // 5 old-side lines: a, blank, b, blank, c -- plus the added replacement.
    expect(parsed.hunks[0].lines).toEqual([' a', ' ', '-b', '+B-CHANGED', ' ', ' c']);
  });

  it('returns an empty model for an empty diff', () => {
    const parsed = parseUnifiedDiffToHunks('');
    expect(parsed.hunks).toEqual([]);
  });
});

describe('filterPatchToHunks', () => {
  it('reproduces the input byte-for-byte when every hunk is selected', () => {
    for (const fixture of [THREE_HUNKS, NO_NEWLINE_EOF, EMPTY_CONTEXT_LINE]) {
      const parsed = parseUnifiedDiffToHunks(fixture);
      const all = parsed.hunks.map((h) => h.index);
      expect(filterPatchToHunks(parsed, all)).toBe(fixture);
    }
  });

  it('pulls later hunks back by the size of a dropped leading hunk', () => {
    const parsed = parseUnifiedDiffToHunks(THREE_HUNKS);
    // Drop hunk 0 (net +2). Hunks 1 and 2 must lose that offset: +11 -> +9, +24 -> +22.
    const patch = filterPatchToHunks(parsed, [1, 2]);
    const headers = patch.split('\n').filter((l) => l.startsWith('@@'));

    expect(headers).toEqual(['@@ -9,7 +9,7 @@ line8', '@@ -22,7 +22,6 @@ line21']);
    expect(patch).not.toContain('NEW-A');
    expect(patch).toContain('+CHANGED12');
  });

  it('leaves the old side untouched so the patch still applies against HEAD', () => {
    const parsed = parseUnifiedDiffToHunks(THREE_HUNKS);
    const patch = filterPatchToHunks(parsed, [2]);
    expect(patch).toContain('@@ -22,7 +22,6 @@ line21');
  });

  it('accumulates the delta across several selected hunks', () => {
    const parsed = parseUnifiedDiffToHunks(THREE_HUNKS);
    // Keep hunk 0 (net +2) and hunk 2. Hunk 2 keeps the +2 offset but not the
    // -0 from the skipped middle hunk, so it lands at 22 + 2 = 24.
    const headers = filterPatchToHunks(parsed, [0, 2])
      .split('\n')
      .filter((l) => l.startsWith('@@'));
    expect(headers).toEqual(['@@ -1,5 +1,7 @@', '@@ -22,7 +24,6 @@ line21']);
  });

  it('carries the no-newline marker into the filtered patch', () => {
    const parsed = parseUnifiedDiffToHunks(NO_NEWLINE_EOF);
    expect(filterPatchToHunks(parsed, [0])).toContain('\\ No newline at end of file');
  });

  it('returns an empty string when nothing is selected', () => {
    const parsed = parseUnifiedDiffToHunks(THREE_HUNKS);
    expect(filterPatchToHunks(parsed, [])).toBe('');
  });
});

describe('matchHunkRefs', () => {
  const refsOf = (diff: string): HunkRef[] =>
    parseUnifiedDiffToHunks(diff).hunks.map((h) => ({
      oldStart: h.oldStart,
      oldLines: h.oldLines,
      newStart: h.newStart,
      newLines: h.newLines,
    }));

  it('resolves refs captured from the same diff', () => {
    const parsed = parseUnifiedDiffToHunks(THREE_HUNKS);
    const result = matchHunkRefs(parsed, [refsOf(THREE_HUNKS)[2], refsOf(THREE_HUNKS)[0]]);
    expect(result.unmatched).toEqual([]);
    expect(result.indices).toEqual([0, 2]);
  });

  it('reports a ref that no longer matches, rather than silently dropping it', () => {
    const parsed = parseUnifiedDiffToHunks(THREE_HUNKS);
    // What a sibling session's write looks like: the hunk moved down a line.
    const stale: HunkRef = { oldStart: 9, oldLines: 7, newStart: 12, newLines: 7 };
    const result = matchHunkRefs(parsed, [stale]);
    expect(result.indices).toEqual([]);
    expect(result.unmatched).toEqual([stale]);
  });

  it('does not match two refs to the same hunk', () => {
    const parsed = parseUnifiedDiffToHunks(THREE_HUNKS);
    const dup = refsOf(THREE_HUNKS)[0];
    const result = matchHunkRefs(parsed, [dup, { ...dup }]);
    expect(result.indices).toEqual([0]);
    expect(result.unmatched).toHaveLength(1);
  });
});

describe('supportsHunkSelection', () => {
  it('allows selection on an ordinary modification', () => {
    expect(supportsHunkSelection(parseUnifiedDiffToHunks(THREE_HUNKS))).toBe(true);
  });

  it('refuses files with no HEAD blob to apply against', () => {
    const added = lines(
      'diff --git a/n.txt b/n.txt',
      'new file mode 100644',
      'index 0000000..7898192',
      '--- /dev/null',
      '+++ b/n.txt',
      '@@ -0,0 +1 @@',
      '+a',
    );
    expect(supportsHunkSelection(parseUnifiedDiffToHunks(added))).toBe(false);

    const deleted = lines(
      'diff --git a/d.txt b/d.txt',
      'deleted file mode 100644',
      'index 7898192..0000000',
      '--- a/d.txt',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-a',
    );
    expect(supportsHunkSelection(parseUnifiedDiffToHunks(deleted))).toBe(false);
  });

  it('refuses binary files', () => {
    const binary = lines(
      'diff --git a/b.png b/b.png',
      'index 1234567..89abcde 100644',
      'Binary files a/b.png and b/b.png differ',
    );
    expect(supportsHunkSelection(parseUnifiedDiffToHunks(binary))).toBe(false);
  });
});
