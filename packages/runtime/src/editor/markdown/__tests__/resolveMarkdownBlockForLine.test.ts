// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resolveMarkdownBlockForLine } from '../resolveMarkdownBlockForLine';
import type { MarkdownBlockLineRange } from '../EnhancedMarkdownExport';

// A five-block document; block text is what each range covers in `lines`.
const lines = [
  '# Alpha',            // 1
  '',                   // 2
  'The quick brown fox',// 3
  '',                   // 4
  '## Beta',            // 5
  '',                   // 6
  'jumps over the dog', // 7
];

const ranges: MarkdownBlockLineRange[] = [
  { nodeKey: 'alpha', startLine: 1, endLine: 1 },
  { nodeKey: 'gap1', startLine: 2, endLine: 2 },
  { nodeKey: 'fox', startLine: 3, endLine: 3 },
  { nodeKey: 'gap2', startLine: 4, endLine: 4 },
  { nodeKey: 'beta', startLine: 5, endLine: 5 },
  { nodeKey: 'gap3', startLine: 6, endLine: 6 },
  { nodeKey: 'dog', startLine: 7, endLine: 7 },
];

function resolve(targetLine: number, sourceLineText?: string) {
  return resolveMarkdownBlockForLine({ ranges, exportedLines: lines, targetLine, sourceLineText });
}

describe('resolveMarkdownBlockForLine', () => {
  it('returns the block containing the line', () => {
    expect(resolve(5)).toBe('beta');
  });

  it('clamps a line past the end of the document to the last block', () => {
    expect(resolve(9999)).toBe('dog');
  });

  it('clamps a line before the first block', () => {
    expect(resolve(0)).toBe('alpha');
  });

  it('returns null for an empty document rather than inventing a target', () => {
    expect(
      resolveMarkdownBlockForLine({ ranges: [], exportedLines: [], targetLine: 3 })
    ).toBeNull();
  });

  // The correction is what makes drift survivable: the map says line 5, but the
  // text the user clicked actually lives two blocks away.
  it('corrects to the block that actually contains the target line text', () => {
    expect(resolve(5, 'jumps over the dog')).toBe('dog');
  });

  it('keeps the mapped block when its text already matches', () => {
    expect(resolve(3, 'The quick brown fox')).toBe('fox');
  });

  it('prefers the nearest match when several blocks would match', () => {
    const repeated: MarkdownBlockLineRange[] = [
      { nodeKey: 'far', startLine: 1, endLine: 1 },
      { nodeKey: 'mapped', startLine: 2, endLine: 2 },
      { nodeKey: 'near', startLine: 3, endLine: 3 },
    ];
    const repeatedLines = ['same text here', 'different', 'same text here'];

    expect(
      resolveMarkdownBlockForLine({
        ranges: repeated,
        exportedLines: repeatedLines,
        targetLine: 2,
        sourceLineText: 'same text here',
      })
    ).toBe('far');
  });

  it('skips correction for a blank target line', () => {
    expect(resolve(5, '   ')).toBe('beta');
  });

  it('skips correction for a line too plain to identify anything', () => {
    // A bare fence or rule matches half the document; trusting it would scroll
    // somewhere arbitrary, which is worse than trusting the map.
    expect(resolve(5, '---')).toBe('beta');
    expect(resolve(5, '```')).toBe('beta');
  });

  it('falls back to the mapped block when nothing in range matches', () => {
    expect(resolve(5, 'text that appears nowhere in this document')).toBe('beta');
  });

  it('does not correct beyond the search window', () => {
    const wide: MarkdownBlockLineRange[] = Array.from({ length: 12 }, (_, i) => ({
      nodeKey: `b${i}`,
      startLine: i + 1,
      endLine: i + 1,
    }));
    const wideLines = wide.map((_, i) => (i === 11 ? 'the needle text' : `filler ${i}`));

    expect(
      resolveMarkdownBlockForLine({
        ranges: wide,
        exportedLines: wideLines,
        targetLine: 1,
        sourceLineText: 'the needle text',
      })
    ).toBe('b0');
  });
});
