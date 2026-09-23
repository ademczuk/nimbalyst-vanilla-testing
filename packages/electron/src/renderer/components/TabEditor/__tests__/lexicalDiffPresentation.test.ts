// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  decideLexicalDiffByBytes,
  decideLexicalDiffByRootNodes,
  lexicalDiffTooLargeReason,
  LEXICAL_DIFF_MAX_BYTES,
  LEXICAL_DIFF_MAX_ROOT_NODES,
} from '../lexicalDiffPresentation';

/**
 * The guards from #4821, extracted out of the mount path so they survive its
 * deletion (NIM-5359 Phase 6). What matters here is the boundary and the fact
 * that BOTH sides of the diff are measured: the incident file shrank from 420KB
 * to 280KB, so a guard that only looked at the new content would have let the
 * unaffordable matrix through.
 */
describe('lexical diff presentation decision', () => {
  const big = 'x'.repeat(LEXICAL_DIFF_MAX_BYTES + 1);
  const atLimit = 'x'.repeat(LEXICAL_DIFF_MAX_BYTES);

  it('renders inline at exactly the byte limit on both sides', () => {
    expect(decideLexicalDiffByBytes(atLimit, atLimit)).toEqual({ presentation: 'inline' });
  });

  it('falls back when either side is over the byte limit', () => {
    expect(decideLexicalDiffByBytes(big, 'small').presentation).toBe('no-inline-fallback');
    expect(decideLexicalDiffByBytes('small', big).presentation).toBe('no-inline-fallback');
  });

  it('names both lengths and the threshold so the log says why', () => {
    const decision = decideLexicalDiffByBytes(big, 'abc');
    expect(decision).toEqual({
      presentation: 'no-inline-fallback',
      reason: `oldLen=${big.length} newLen=3 byteThreshold=${LEXICAL_DIFF_MAX_BYTES}`,
    });
  });

  it('renders inline at exactly the root-node limit and falls back one above', () => {
    expect(decideLexicalDiffByRootNodes(LEXICAL_DIFF_MAX_ROOT_NODES))
      .toEqual({ presentation: 'inline' });
    expect(decideLexicalDiffByRootNodes(LEXICAL_DIFF_MAX_ROOT_NODES + 1)).toEqual({
      presentation: 'no-inline-fallback',
      reason: `rootNodes=${LEXICAL_DIFF_MAX_ROOT_NODES + 1} nodeThreshold=${LEXICAL_DIFF_MAX_ROOT_NODES}`,
    });
  });

  /**
   * Bytes are only a pre-filter: a small document made of thousands of list
   * items is the shape that actually kills the matcher, and it passes the byte
   * check. The two guards are not interchangeable.
   */
  it('catches a node-dense document the byte pre-filter passes', () => {
    const dense = '- item\n'.repeat(3000);
    expect(dense.length).toBeLessThan(LEXICAL_DIFF_MAX_BYTES);
    expect(decideLexicalDiffByBytes(dense, dense).presentation).toBe('inline');
    expect(decideLexicalDiffByRootNodes(3000).presentation).toBe('no-inline-fallback');
  });

  it("treats only the matcher's DIFF_TOO_LARGE refusal as a no-inline presentation", () => {
    // Anything else is a real failure the model must recover from; the size
    // refusal must not be, or the same multi-second diff is replayed.
    const message = 'Document too large to diff structurally: pair budget';
    expect(lexicalDiffTooLargeReason({ ok: false, errorType: 'DIFF_TOO_LARGE', message })).toBe(message);
    expect(lexicalDiffTooLargeReason({ ok: false, errorType: 'TEXT_REPLACEMENT_ERROR', message })).toBeNull();
    expect(lexicalDiffTooLargeReason({ ok: true })).toBeNull();
    expect(lexicalDiffTooLargeReason(null)).toBeNull();
  });
});
