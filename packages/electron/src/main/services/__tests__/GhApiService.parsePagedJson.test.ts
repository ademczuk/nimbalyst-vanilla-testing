// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildApiArgs, parsePagedJson } from '../GhApiService';

describe('parsePagedJson', () => {
  it('reads a single JSON array', () => {
    expect(parsePagedJson<{ n: number }>('[{"n":1},{"n":2}]')).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it('flattens concatenated pages', () => {
    expect(parsePagedJson<{ n: number }>('[{"n":1}]\n[{"n":2}]')).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it('recovers every page when gh closes the merged array early', () => {
    // Observed from `gh api --paginate --cache 60s` (gh 2.92.0) when several
    // gh processes race on the shared HTTP cache: page one keeps its closing
    // `]`, later pages are spliced in as bare comma-separated objects, and a
    // single `]` trails the whole thing. Naive top-level slicing keeps page
    // one and silently drops the rest.
    const stdout = '[{"n":1},{"n":2}],{"n":3},{"n":4}]';

    expect(parsePagedJson<{ n: number }>(stdout)).toEqual([
      { n: 1 },
      { n: 2 },
      { n: 3 },
      { n: 4 },
    ]);
  });

  it('ignores brackets inside string values', () => {
    expect(parsePagedJson<{ t: string }>('[{"t":"] [ \\" }"}]')).toEqual([{ t: '] [ " }' }]);
  });

  it('returns nothing for empty output', () => {
    expect(parsePagedJson('   ')).toEqual([]);
  });
});

describe('buildApiArgs', () => {
  it('omits --cache while paginating', () => {
    // gh's page-merging races against its own on-disk cache, so the two flags
    // must never be combined.
    const args = buildApiArgs('repos/o/r/pulls', { cacheSeconds: 60, paginate: true });

    expect(args).toContain('--paginate');
    expect(args).not.toContain('--cache');
  });

  it('caches single-page requests', () => {
    expect(buildApiArgs('repos/o/r', { cacheSeconds: 60 })).toEqual(
      expect.arrayContaining(['--cache', '60s']),
    );
  });
});
