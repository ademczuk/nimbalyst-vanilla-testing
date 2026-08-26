// @vitest-environment node

/**
 * Quick open's order is the part a reader cannot check.
 *
 * The palette shows a flat list of documents and tracker items with nothing
 * saying why one is above another, so a wrong order and a right one look
 * identical -- which is exactly what a test is for, and why there is no test
 * here for "the palette renders" or "there are two kinds".
 */

import { describe, expect, it } from 'vitest';
import { rankQuickOpenEntries, type QuickOpenEntry } from '../quickOpenRanking';

const DAY = 86_400_000;
const T0 = 1_756_000_000_000;

function doc(title: string, extra: Partial<QuickOpenEntry> = {}): QuickOpenEntry {
  return { kind: 'document', id: `doc-${title}`, title, updatedAt: T0, ...extra };
}

function item(title: string, extra: Partial<QuickOpenEntry> = {}): QuickOpenEntry {
  return { kind: 'tracker', id: `item-${title}`, title, updatedAt: T0, ...extra };
}

const ids = (entries: readonly QuickOpenEntry[]) => entries.map((entry) => entry.id);

describe('rankQuickOpenEntries', () => {
  it('pins an exact issue-key match above every text match for the same digits', () => {
    // The reason the desktop pins these at all: "2374" is a perfectly good
    // substring of a dozen titles and a release note, and none of them is the
    // item the reader just typed the key of.
    const corpus = [
      doc('Release 2374 retrospective', { updatedAt: T0 + DAY }),
      item('Something else entirely', { key: 'NIM-2374', updatedAt: T0 - DAY }),
      item('2374 candidates to triage', { key: 'NIM-1', updatedAt: T0 + DAY }),
    ];

    expect(ids(rankQuickOpenEntries(corpus, 'NIM-2374'))[0]).toBe('item-Something else entirely');
    // A bare number, a lowercase prefix and a "#" all name the same item.
    expect(ids(rankQuickOpenEntries(corpus, '2374'))[0]).toBe('item-Something else entirely');
    expect(ids(rankQuickOpenEntries(corpus, 'nim 2374'))[0]).toBe('item-Something else entirely');
    expect(ids(rankQuickOpenEntries(corpus, '#2374'))[0]).toBe('item-Something else entirely');
  });

  it('ranks by where the query landed, not by which corpus it came from', () => {
    const corpus = [
      item('Retry policy notes', { detail: 'covers auth as well' }),
      doc('Nothing relevant', { subtitle: 'engineering/auth' }),
      item('Rotate the auth key', { key: 'NIM-9' }),
      doc('auth', {}),
      doc('Reauthorize the webhook', {}),
      doc('auth handoff design', {}),
    ];

    // exact title, prefix, word-boundary, mid-word, subtitle, detail.
    expect(ids(rankQuickOpenEntries(corpus, 'auth'))).toEqual([
      'doc-auth',
      'doc-auth handoff design',
      'item-Rotate the auth key',
      'doc-Reauthorize the webhook',
      'doc-Nothing relevant',
      'item-Retry policy notes',
    ]);
  });

  it('requires every term to land somewhere', () => {
    const corpus = [
      doc('Auth token rotation'),
      doc('Auth overview'),
      doc('Token bucket limits'),
    ];

    // Not "everything about auth, plus everything about tokens".
    expect(ids(rankQuickOpenEntries(corpus, 'auth token'))).toEqual(['doc-Auth token rotation']);
  });

  it('breaks equal scores by recency, and orders an empty query by it too', () => {
    const corpus = [
      doc('Sync plan alpha', { updatedAt: T0 }),
      doc('Sync plan beta', { updatedAt: T0 + DAY }),
      doc('Sync plan gamma', { updatedAt: T0 - DAY }),
    ];

    expect(ids(rankQuickOpenEntries(corpus, 'sync plan'))).toEqual([
      'doc-Sync plan beta',
      'doc-Sync plan alpha',
      'doc-Sync plan gamma',
    ]);
    expect(ids(rankQuickOpenEntries(corpus, '   '))).toEqual([
      'doc-Sync plan beta',
      'doc-Sync plan alpha',
      'doc-Sync plan gamma',
    ]);
  });

  it('survives the fields a real corpus leaves empty', () => {
    // A frontmatter-projected item arrives with no key, no detail and a
    // timestamp that never parsed; an unguarded compare took the desktop
    // dialog down through its error boundary.
    const corpus = [
      item('', { key: null, detail: null, updatedAt: null }),
      doc('Untitled', { subtitle: null, updatedAt: null }),
    ];

    expect(() => rankQuickOpenEntries(corpus, 'untitled')).not.toThrow();
    expect(ids(rankQuickOpenEntries(corpus, 'untitled'))).toEqual(['doc-Untitled']);
    expect(rankQuickOpenEntries(corpus, '')).toHaveLength(2);
  });

  it('applies the limit after pinning, so a key match cannot be truncated away', () => {
    // Every filler title starts with the query, so all thirty outrank the
    // pinned item on text alone and would push it past a limit of three.
    const filler = Array.from({ length: 30 }, (_, index) => doc(`NIM-7 note ${index}`));
    const corpus = [...filler, item('The actual item', { key: 'NIM-7', updatedAt: T0 - DAY })];

    const ranked = rankQuickOpenEntries(corpus, 'NIM-7', { limit: 3 });
    expect(ranked).toHaveLength(3);
    expect(ranked[0]!.id).toBe('item-The actual item');
  });
});
