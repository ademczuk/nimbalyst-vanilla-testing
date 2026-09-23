// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  validateCitationLocator,
  validateCitationLocatorList,
  describeCitationLocator,
  type CitationLocator,
} from '../citationLocator.js';
import { TrackerDataModelRegistry, type TrackerDataModel } from '../TrackerDataModel.js';

const REVISION_UUID = '9f2c1d4a-7b31-4e59-a0c8-5d6e2f1b3a77';

/** The five 4.4 selectors plus 4.9's, exactly as the contract writes them. */
const CONTRACT_EXAMPLES: CitationLocator[] = [
  {
    selectorType: 'repo-lines',
    version: 1,
    repository: 'github.com/x/y',
    commit: 'abc123',
    path: 'docs/a.md',
    startLine: 10,
    endLine: 14,
  },
  { selectorType: 'html-fragment', version: 1, fragment: '#cursor', quote: 'exact text', prefix: '', suffix: '' },
  { selectorType: 'pdf-page', version: 1, page: 4, quote: 'exact text' },
  { selectorType: 'media-time', version: 1, start: 61.0, end: 75.5 },
  { selectorType: 'result-path', version: 1, artifactDigest: 'sha256-abc', path: '$.checks[2].outcome' },
  {
    selectorType: 'scope-node',
    version: 1,
    scopeId: 'team:proj_123',
    nodeId: 'n5-extends-contract',
    revisionId: REVISION_UUID,
  },
];

function codes(value: unknown): string[] {
  const result = validateCitationLocator(value);
  return result.valid ? [] : result.issues.map((i) => i.code);
}

describe('validateCitationLocator', () => {
  it('accepts every selector example written into contracts 4.4 and 4.9', () => {
    for (const example of CONTRACT_EXAMPLES) {
      const result = validateCitationLocator(example);
      expect(result.valid, `${example.selectorType}: ${JSON.stringify(result.issues)}`).toBe(true);
    }
  });

  it.each([
    ['not an object', 'a string', ['LOCATOR_NOT_AN_OBJECT']],
    ['an array', [], ['LOCATOR_NOT_AN_OBJECT']],
    ['no selectorType', { version: 1 }, ['LOCATOR_MISSING_SELECTOR_TYPE']],
    [
      'an unknown selectorType',
      { selectorType: 'epub-cfi', version: 1 },
      ['LOCATOR_UNKNOWN_SELECTOR_TYPE'],
    ],
    [
      'no version',
      { selectorType: 'pdf-page', page: 4 },
      ['LOCATOR_MISSING_VERSION'],
    ],
    [
      'a future version',
      { selectorType: 'pdf-page', version: 2, page: 4 },
      ['LOCATOR_UNSUPPORTED_VERSION'],
    ],
  ])('rejects %s', (_label, value, expected) => {
    expect(codes(value)).toEqual(expected);
  });

  it('rejects an unrecognized property rather than ignoring it', () => {
    // The failure this prevents: `startline` is dropped, `startLine` is
    // missing, and the locator silently addresses a whole file.
    const result = validateCitationLocator({
      selectorType: 'repo-lines',
      version: 1,
      repository: 'github.com/x/y',
      commit: 'abc123',
      path: 'docs/a.md',
      startline: 10,
      endLine: 14,
    });
    expect(result.valid).toBe(false);
    expect(result.issues.map((i) => [i.code, i.path])).toEqual(
      expect.arrayContaining([
        ['LOCATOR_UNKNOWN_FIELD', 'startline'],
        ['LOCATOR_MISSING_FIELD', 'startLine'],
      ]),
    );
  });

  it('reports every issue in one pass instead of stopping at the first', () => {
    const result = validateCitationLocator({
      selectorType: 'repo-lines',
      version: 1,
      repository: '',
      commit: 'abc123',
      path: 'docs/a.md',
      startLine: 0,
    });
    expect(result.valid).toBe(false);
    expect(result.issues.map((i) => i.path).sort()).toEqual(['endLine', 'repository', 'startLine']);
  });

  describe('repo-lines', () => {
    const base = {
      selectorType: 'repo-lines' as const,
      version: 1 as const,
      repository: 'github.com/x/y',
      commit: 'abc123',
      path: 'docs/a.md',
      startLine: 10,
      endLine: 14,
    };

    it('rejects an inverted line range', () => {
      expect(codes({ ...base, startLine: 14, endLine: 10 })).toEqual(['LOCATOR_RANGE_INVERTED']);
    });

    it('accepts a single-line range', () => {
      expect(validateCitationLocator({ ...base, startLine: 10, endLine: 10 }).valid).toBe(true);
    });

    it('rejects a zero or fractional line number', () => {
      expect(codes({ ...base, startLine: 0 })).toEqual(['LOCATOR_INVALID_FIELD']);
      expect(codes({ ...base, startLine: 1.5 })).toEqual(['LOCATOR_INVALID_FIELD']);
    });

    it.each([['/etc/passwd'], ['../../../etc/passwd'], ['docs/../../out']])(
      'rejects a path escaping the repository: %s',
      (path) => {
        expect(codes({ ...base, path })).toEqual(['LOCATOR_INVALID_FIELD']);
      },
    );

    it('rejects a commit that is a URL rather than a resolved id', () => {
      expect(codes({ ...base, commit: 'https://github.com/x/y/tree/main' })).toEqual([
        'LOCATOR_INVALID_FIELD',
      ]);
    });

    it('treats a whitespace-only required string as empty', () => {
      expect(codes({ ...base, repository: '   ' })).toEqual(['LOCATOR_INVALID_FIELD']);
    });
  });

  describe('html-fragment', () => {
    it('accepts a fragment alone or a quote alone', () => {
      expect(validateCitationLocator({ selectorType: 'html-fragment', version: 1, fragment: '#a' }).valid)
        .toBe(true);
      expect(validateCitationLocator({ selectorType: 'html-fragment', version: 1, quote: 'text' }).valid)
        .toBe(true);
    });

    it('rejects a locator with neither, which would address the whole document', () => {
      expect(codes({ selectorType: 'html-fragment', version: 1, prefix: 'a', suffix: 'b' })).toEqual([
        'LOCATOR_MISSING_FIELD',
      ]);
    });
  });

  describe('media-time', () => {
    const base = { selectorType: 'media-time' as const, version: 1 as const, start: 61 };

    it('accepts an instant with no end', () => {
      expect(validateCitationLocator(base).valid).toBe(true);
    });

    it('rejects an inverted range', () => {
      expect(codes({ ...base, end: 60 })).toEqual(['LOCATOR_RANGE_INVERTED']);
    });

    it('rejects a negative or non-finite start', () => {
      expect(codes({ ...base, start: -1 })).toEqual(['LOCATOR_INVALID_FIELD']);
      expect(codes({ ...base, start: Number.NaN })).toEqual(['LOCATOR_INVALID_FIELD']);
    });
  });

  describe('result-path', () => {
    const base = {
      selectorType: 'result-path' as const,
      version: 1 as const,
      artifactDigest: 'sha256-abc',
      path: '$.checks[2].outcome',
    };

    it('rejects a digest with no algorithm prefix', () => {
      expect(codes({ ...base, artifactDigest: 'abc123' })).toEqual(['LOCATOR_INVALID_FIELD']);
    });

    it('rejects a path that is not a JSONPath', () => {
      expect(codes({ ...base, path: 'checks[2].outcome' })).toEqual(['LOCATOR_INVALID_FIELD']);
    });
  });

  describe('scope-node', () => {
    const base = {
      selectorType: 'scope-node' as const,
      version: 1 as const,
      scopeId: 'team:proj_123',
      nodeId: 'n5',
      revisionId: REVISION_UUID,
    };

    it('pins the revision UUID, never the room-assigned number', () => {
      // Contract 4.2/4.9 amendment: a `serverRevision` does not exist in the
      // personal scope and does not exist before a write syncs, so binding to
      // it would force the locator to be rewritten later.
      expect(codes({ ...base, revisionId: 4 })).toEqual(['LOCATOR_INVALID_FIELD']);
      expect(codes({ ...base, revisionId: '4' })).toEqual(['LOCATOR_INVALID_FIELD']);
      const { revisionId: _omitted, ...withoutRevision } = base;
      expect(codes({ ...withoutRevision, revision: 4 })).toEqual(
        expect.arrayContaining(['LOCATOR_UNKNOWN_FIELD', 'LOCATOR_MISSING_FIELD']),
      );
    });

    it('accepts serverRevision alongside the UUID as an advisory hint', () => {
      expect(validateCitationLocator({ ...base, serverRevision: 4 }).valid).toBe(true);
      expect(codes({ ...base, serverRevision: 0 })).toEqual(['LOCATOR_INVALID_FIELD']);
    });

    // Amended 2026-09-22 with N8: `public:` was accepted here until the 4.3/4.9
    // naming collision was resolved. `revisionId` is a UUID, and a scope that
    // publishes by release assigns none, so a public `scope-node` would validate
    // and never resolve. See the module header and the sibling case in
    // predicateRegistry.test.ts.
    it.each([['me:'], ['team:proj_123'], ['org:org_1']])(
      'accepts scope id %s',
      (scopeId) => {
        expect(validateCitationLocator({ ...base, scopeId }).valid).toBe(true);
      },
    );

    it('rejects a public scope, whose revisions are opaque publication strings', () => {
      expect(codes({ ...base, scopeId: 'public:testedknowhow' }))
        .toEqual(['LOCATOR_SCOPE_NODE_UNVERSIONED_SCOPE']);
    });

    it.each([['me'], ['team:'], ['workspace:proj_123'], ['team:proj 123']])(
      'rejects scope id %s',
      (scopeId) => {
        expect(codes({ ...base, scopeId })).toEqual(['LOCATOR_INVALID_FIELD']);
      },
    );
  });
});

describe('validateCitationLocatorList', () => {
  const valid = CONTRACT_EXAMPLES[2];

  it('accepts an empty list: an unbound decision is a 4.9 warning, not a shape error', () => {
    const result = validateCitationLocatorList([]);
    expect(result.valid).toBe(true);
    expect(result.locators).toEqual([]);
  });

  it('rejects a non-array', () => {
    const result = validateCitationLocatorList(valid);
    expect(result.valid).toBe(false);
    expect(result.issues[0].code).toBe('LOCATOR_NOT_AN_ARRAY');
  });

  it('prefixes issue paths with the offending entry index', () => {
    const result = validateCitationLocatorList([valid, { selectorType: 'pdf-page', version: 1 }]);
    expect(result.valid).toBe(false);
    expect(result.issues).toEqual([
      { code: 'LOCATOR_MISSING_FIELD', path: '[1].page', message: expect.any(String) },
    ]);
  });

  it('indexes an entry-level issue that has no property path', () => {
    const result = validateCitationLocatorList(['nope']);
    expect(result.issues[0].path).toBe('[0]');
  });
});

/**
 * The same validator has to reach item writes, or none of the above is
 * enforced anywhere a user can actually get to. `objectShape` is the routing
 * marker; a field name would have made `locator` mean this everywhere.
 */
describe('TrackerDataModelRegistry.validate routes declared locator shapes', () => {
  const model: TrackerDataModel = {
    type: 'evidence-fixture',
    displayName: 'Evidence fixture',
    fields: [
      { name: 'title', type: 'string', required: true },
      // A citation item's single locator.
      { name: 'locator', type: 'object', objectShape: 'citation-locator' },
      // A decision-record's `governs`, per contract 4.9: multi-valued.
      { name: 'governs', type: 'array', itemType: 'object', objectShape: 'citation-locator' },
      // Entries reference citation items, not locators.
      { name: 'citations', type: 'citation' },
    ],
  } as TrackerDataModel;

  const registry = new TrackerDataModelRegistry();
  registry.register(model);

  const goodLocator = { selectorType: 'pdf-page', version: 1, page: 4 };

  it('accepts valid locators on both the single and the multi-valued field', () => {
    const result = registry.validate('evidence-fixture', {
      title: 't',
      locator: goodLocator,
      governs: [goodLocator],
      citations: [{ itemId: 'cit_1', title: 'A citation' }],
    });
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('surfaces the locator error code and a field path a form can point at', () => {
    const result = registry.validate('evidence-fixture', {
      title: 't',
      locator: { selectorType: 'pdf-page', version: 1, page: 0 },
      governs: [goodLocator, { selectorType: 'nope', version: 1 }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => [e.code, e.field])).toEqual([
      ['LOCATOR_INVALID_FIELD', 'locator.page'],
      ['LOCATOR_UNKNOWN_SELECTOR_TYPE', 'governs[1].selectorType'],
    ]);
  });

  it('reports a non-array `governs` once, as an array error', () => {
    const result = registry.validate('evidence-fixture', { title: 't', governs: goodLocator });
    expect(result.errors.map((e) => e.field)).toEqual(['governs', 'governs']);
    expect(result.errors.map((e) => e.code)).toEqual([undefined, 'LOCATOR_NOT_AN_ARRAY']);
  });

  it('rejects a citation entry with no itemId', () => {
    const result = registry.validate('evidence-fixture', {
      title: 't',
      citations: [{ title: 'no id' }],
    });
    expect(result.errors.map((e) => e.code)).toEqual(['CITATION_FIELD_INVALID_ENTRY']);
  });
});

describe('describeCitationLocator', () => {
  it.each([
    [CONTRACT_EXAMPLES[0], 'docs/a.md:10-14 @ abc123'],
    [CONTRACT_EXAMPLES[1], '#cursor'],
    [CONTRACT_EXAMPLES[2], 'p. 4'],
    [CONTRACT_EXAMPLES[3], '1:01-1:15'],
    [CONTRACT_EXAMPLES[5], 'team:proj_123:n5-extends-contract'],
  ])('summarizes %#', (locator, expected) => {
    expect(describeCitationLocator(locator)).toBe(expected);
  });

  it('does not double the separator on the personal scope id', () => {
    expect(
      describeCitationLocator({
        selectorType: 'scope-node',
        version: 1,
        scopeId: 'me:',
        nodeId: 'n5',
        revisionId: REVISION_UUID,
      }),
    ).toBe('me:n5');
  });
});
