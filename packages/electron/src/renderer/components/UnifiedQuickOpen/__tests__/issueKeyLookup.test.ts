// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { TrackerItem } from '@nimbalyst/runtime/core/DocumentService';
import {
  findTrackersByIssueKey,
  matchesTrackerText,
  mergeIssueKeyMatches,
  parseIssueKeyQuery,
} from '../issueKeyLookup';

function item(partial: Partial<TrackerItem> & { id: string }): TrackerItem {
  return {
    type: 'bug',
    title: `Item ${partial.id}`,
    ...partial,
  } as TrackerItem;
}

const ITEMS: TrackerItem[] = [
  item({ id: 'a', issueKey: 'NIM-2374', updated: '2026-08-01T00:00:00Z' }),
  item({ id: 'b', issueKey: 'NIM-12374', updated: '2026-08-02T00:00:00Z' }),
  item({ id: 'c', issueKey: 'STR-2374', updated: '2026-08-03T00:00:00Z' }),
  item({ id: 'd', issueKey: 'NIM-99', archived: true }),
  item({ id: 'e', title: 'No key at all' }),
];

describe('parseIssueKeyQuery', () => {
  it.each([
    ['NIM-2374', { prefix: 'nim', number: '2374' }],
    ['nim 2374', { prefix: 'nim', number: '2374' }],
    ['nim2374', { prefix: 'nim', number: '2374' }],
    ['#2374', { prefix: null, number: '2374' }],
    ['2374', { prefix: null, number: '2374' }],
    ['0024', { prefix: null, number: '24' }],
  ])('parses %s', (query, expected) => {
    expect(parseIssueKeyQuery(query)).toEqual(expected);
  });

  it.each(['', 'lexical barrel', 'NIM-', 'v1.2', 'nim-12-34'])(
    'rejects %s as not key-shaped',
    (query) => {
      expect(parseIssueKeyQuery(query)).toBeNull();
    },
  );
});

describe('findTrackersByIssueKey', () => {
  it('matches the exact key, not a number that merely appears inside one', () => {
    expect(findTrackersByIssueKey('NIM-2374', ITEMS).map((i) => i.id)).toEqual(['a']);
  });

  it('matches any prefix for a bare number, newest first', () => {
    expect(findTrackersByIssueKey('2374', ITEMS).map((i) => i.id)).toEqual(['c', 'a']);
  });

  it('skips archived items and items without a key', () => {
    expect(findTrackersByIssueKey('99', ITEMS)).toEqual([]);
    expect(findTrackersByIssueKey('a plain phrase', ITEMS)).toEqual([]);
  });
});

describe('matchesTrackerText', () => {
  it('survives a frontmatter item with no title', () => {
    const untitled = { id: 'fm:plan:notes.md', title: null } as unknown as TrackerItem;
    expect(() => matchesTrackerText(untitled, 'plan')).not.toThrow();
    expect(matchesTrackerText(untitled, 'notes')).toBe(true);
  });

  it('matches title, key, description and id', () => {
    const it0 = item({ id: 'x1', issueKey: 'NIM-5', title: 'Widget', description: 'gadget' });
    expect(matchesTrackerText(it0, 'widg')).toBe(true);
    expect(matchesTrackerText(it0, 'nim-5')).toBe(true);
    expect(matchesTrackerText(it0, 'gadget')).toBe(true);
    expect(matchesTrackerText(it0, 'x1')).toBe(true);
    expect(matchesTrackerText(it0, 'absent')).toBe(false);
  });
});

describe('mergeIssueKeyMatches', () => {
  const semantic = [
    { refType: 'tracker', refId: 'a', title: 'semantic dupe' },
    { refType: 'session', refId: 'a', title: 'different ref type, kept' },
    { refType: 'doc-file', refId: 'z', title: 'unrelated' },
  ] as SemanticSearchResult[];

  it('pins exact matches first and drops the duplicate tracker hit', () => {
    const merged = mergeIssueKeyMatches([ITEMS[0]], semantic);
    expect(merged.map((r) => `${r.refType}:${r.refId}`)).toEqual([
      'tracker:a',
      'session:a',
      'doc-file:z',
    ]);
    expect(merged[0].snippet).toBe('NIM-2374');
    expect(merged[0].signals.dense).toBe(false);
  });

  it('passes the semantic ranking through untouched when there is no key match', () => {
    expect(mergeIssueKeyMatches([], semantic)).toEqual(semantic);
  });
});
