// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  scoreTrackerDuplicates,
  type DuplicateIndexEntry,
} from '../scoreTrackerDuplicates';

const entry = (id: string, title: string, extra: Partial<DuplicateIndexEntry> = {}): DuplicateIndexEntry => ({
  id,
  title,
  type: 'bug',
  status: 'to-do',
  ...extra,
});

const index = [
  entry('a', 'Editor hangs on input when pasting large files'),
  entry('b', 'Sidebar width resets after restart'),
  // Shares no content tokens with "app freezes when typing text" — only the
  // semantic arm can connect the two.
  entry('c', 'Composer stalls mid keystroke'),
];

describe('scoreTrackerDuplicates', () => {
  it('matches on shared wording without any semantic arm', () => {
    const matches = scoreTrackerDuplicates(index, 'Editor hangs on input while pasting');
    expect(matches.map((m) => m.entry.id)).toEqual(['a']);
    expect(matches[0].arms).toEqual(['lexical']);
  });

  it('stays silent below the length and token gates', () => {
    // 11 characters: under the length floor even though it would score well.
    expect(scoreTrackerDuplicates(index, 'Editor hang')).toEqual([]);
    // Long enough, but stopwords leave fewer than three content tokens.
    expect(scoreTrackerDuplicates(index, 'it is that the a an of')).toEqual([]);
  });

  it('surfaces a differently-worded item only through the semantic arm, above the cosine floor', () => {
    const query = 'Application freezes while typing text';
    expect(scoreTrackerDuplicates(index, query)).toEqual([]);

    // Below the floor: still nothing. An RRF rank would have said "rank 1".
    expect(scoreTrackerDuplicates(index, query, [{ refId: 'c', cosine: 0.6 }])).toEqual([]);

    const matches = scoreTrackerDuplicates(index, query, [{ refId: 'c', cosine: 0.81 }]);
    expect(matches.map((m) => m.entry.id)).toEqual(['c']);
    expect(matches[0].arms).toEqual(['semantic']);
  });

  it('merges an item both arms returned into one row carrying the higher score', () => {
    const matches = scoreTrackerDuplicates(
      index,
      'Editor hangs on input while pasting',
      [{ refId: 'a', cosine: 0.95 }],
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].arms).toEqual(['lexical', 'semantic']);
    expect(matches[0].score).toBeCloseTo(0.95);
  });

  it('caps the strip and orders the strongest match first', () => {
    const crowded = [
      entry('1', 'Editor hangs on input when pasting large files'),
      entry('2', 'Editor hangs on input sometimes'),
      entry('3', 'Editor hangs on input'),
      entry('4', 'Editor hangs on input always'),
    ];
    const matches = scoreTrackerDuplicates(crowded, 'Editor hangs on input');
    expect(matches).toHaveLength(3);
    expect(matches[0].entry.id).toBe('3');
  });
});
