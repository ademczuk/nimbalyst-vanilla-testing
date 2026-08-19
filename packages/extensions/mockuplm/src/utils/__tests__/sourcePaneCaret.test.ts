// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { remapCaretAcrossReplace } from '../sourcePaneCaret';

describe('remapCaretAcrossReplace', () => {
  it('shifts the caret by the inserted length when a teammate edits above it', () => {
    const prev = '<body>\n<h1>Title</h1>\n</body>';
    const next = '<body>\n<p>New</p>\n<h1>Title</h1>\n</body>';
    const caret = prev.indexOf('Title') + 2;
    expect(next[remapCaretAcrossReplace(prev, next, caret)]).toBe(prev[caret]);
    expect(remapCaretAcrossReplace(prev, next, caret)).toBe(
      caret + (next.length - prev.length),
    );
  });

  it('leaves the caret alone when the edit lands after it', () => {
    const prev = '<h1>Title</h1>\n';
    const next = '<h1>Title</h1>\n<p>New</p>\n';
    expect(remapCaretAcrossReplace(prev, next, 6)).toBe(6);
  });

  it('clamps into the replacement instead of jumping when the edit spans the caret', () => {
    const prev = 'aaaXXXbbb';
    const next = 'aaaYbbb';
    const caret = 5; // inside XXX
    expect(remapCaretAcrossReplace(prev, next, caret)).toBe(4);
  });

  it('holds the caret at the insertion point rather than dragging it along', () => {
    // A teammate appending at the very offset the caret sits on is the one
    // ambiguous case; staying put keeps the caret on the character it was on.
    expect(remapCaretAcrossReplace('abc', 'abcdef', 3)).toBe(3);
  });

  it('clamps a caret past the end of the previous text', () => {
    expect(remapCaretAcrossReplace('abc', 'ab', 99)).toBe(2);
  });
});
