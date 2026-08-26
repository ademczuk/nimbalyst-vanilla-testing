/**
 * Match-and-rank for a quick-open palette over a mixed corpus.
 *
 * The corpus is documents and tracker items together, which is the whole
 * difficulty: they have nothing in common except a title and a timestamp, and
 * ranking them against each other by "whatever each surface already sorts by"
 * gives an order that changes meaning depending on which kind happens to be
 * loaded. So both are projected onto one `QuickOpenEntry` and scored by *where*
 * the query matched, not by which kind matched.
 *
 * Pure and host-free on purpose. Nothing about the ranking is visible on
 * screen -- a reader cannot tell a correct order from a plausible one -- so
 * this is the part that has to be tested rather than looked at.
 */

import { findTrackersByIssueKey, parseIssueKeyQuery } from './issueKeyQuery';

export type QuickOpenEntryKind = 'document' | 'tracker';

export interface QuickOpenEntry {
  kind: QuickOpenEntryKind;
  /** Stable within a kind; the palette keys rows on `${kind}:${id}`. */
  id: string;
  title: string;
  /** Folder path for a document, tracker type for an item. Searched after the title. */
  subtitle?: string | null;
  /** Issue key, or any other citable identifier. Key-matched as well as searched. */
  key?: string | null;
  /** Free text searched last -- a description or summary. */
  detail?: string | null;
  /** Epoch milliseconds. Orders an empty query, and breaks score ties. */
  updatedAt?: number | null;
  /** Material Symbols ligature name the palette draws for this row. */
  icon?: string;
}

/**
 * Where a term matched, highest first. Written as one ladder rather than per
 * field so a title hit can never lose to a description hit on another entry.
 */
const SCORE_TITLE_EXACT = 80;
const SCORE_TITLE_PREFIX = 70;
const SCORE_TITLE_WORD = 60;
const SCORE_TITLE_SUBSTRING = 50;
const SCORE_KEY = 40;
const SCORE_SUBTITLE = 30;
const SCORE_DETAIL = 20;
const NO_MATCH = 0;

export interface RankQuickOpenOptions {
  /** How many entries to return. The palette cannot show more than a screenful. */
  limit?: number;
}

const DEFAULT_LIMIT = 50;

function scoreTerm(entry: QuickOpenEntry, term: string): number {
  const title = entry.title.toLowerCase();
  if (title === term) return SCORE_TITLE_EXACT;
  if (title.startsWith(term)) return SCORE_TITLE_PREFIX;
  // `startsWith` already covered index 0, so any hit here is interior.
  const titleIndex = title.indexOf(term);
  if (titleIndex > 0) {
    // A hit that starts a word reads as intentional; one mid-word is incidental.
    const preceding = title[titleIndex - 1]!;
    return /[\s\-_/.:]/.test(preceding) ? SCORE_TITLE_WORD : SCORE_TITLE_SUBSTRING;
  }
  if (entry.key?.toLowerCase().includes(term)) return SCORE_KEY;
  if (entry.subtitle?.toLowerCase().includes(term)) return SCORE_SUBTITLE;
  if (entry.detail?.toLowerCase().includes(term)) return SCORE_DETAIL;
  return NO_MATCH;
}

/**
 * Every term has to land somewhere, so "auth token" does not return everything
 * about authentication. The entry's score is the mean of its per-term scores,
 * which keeps a two-title-hit entry above one that matched a title and a
 * description.
 */
function scoreEntry(entry: QuickOpenEntry, terms: readonly string[]): number {
  let total = 0;
  for (const term of terms) {
    const score = scoreTerm(entry, term);
    if (score === NO_MATCH) return NO_MATCH;
    total += score;
  }
  return total / terms.length;
}

/** Deterministic, so a test can assert an order rather than a set. */
function compareRanked(
  a: { entry: QuickOpenEntry; score: number },
  b: { entry: QuickOpenEntry; score: number },
): number {
  if (a.score !== b.score) return b.score - a.score;
  const updatedDiff = (b.entry.updatedAt ?? 0) - (a.entry.updatedAt ?? 0);
  if (updatedDiff !== 0) return updatedDiff;
  return a.entry.title.localeCompare(b.entry.title);
}

/**
 * The ranked corpus for `query`.
 *
 * An issue-key-shaped query pins its exact matches to the top ahead of the text
 * ranking, because "2374" ranks by meaning otherwise and never resolves to the
 * item the reader is naming. That is the same rule the desktop's Trackers pane
 * applies; it is stated once, here, rather than in each palette.
 */
export function rankQuickOpenEntries<T extends QuickOpenEntry>(
  entries: readonly T[],
  query: string,
  options: RankQuickOpenOptions = {},
): T[] {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const trimmed = query.trim();

  if (!trimmed) {
    return [...entries]
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || a.title.localeCompare(b.title))
      .slice(0, limit);
  }

  const terms = trimmed.toLowerCase().split(/\s+/).filter(Boolean);

  // Exact key hits are resolved against the same parser the desktop uses, over
  // the tracker half of the corpus only -- a document has no issue key, and a
  // document whose title happens to contain "2374" is a text match, not a key.
  const keyed = parseIssueKeyQuery(trimmed)
    ? findTrackersByIssueKey(
      trimmed,
      entries
        .filter((entry) => entry.kind === 'tracker')
        .map((entry) => ({
          id: entry.id,
          issueKey: entry.key ?? null,
          updated: entry.updatedAt ? new Date(entry.updatedAt).toISOString() : null,
          entry,
        })),
    ).map((candidate) => candidate.entry)
    : [];

  const pinned = new Set(keyed.map((entry) => `${entry.kind}:${entry.id}`));
  const ranked = entries
    .filter((entry) => !pinned.has(`${entry.kind}:${entry.id}`))
    .map((entry) => ({ entry, score: scoreEntry(entry, terms) }))
    .filter((candidate) => candidate.score > NO_MATCH)
    .sort(compareRanked)
    .map((candidate) => candidate.entry);

  return [...keyed, ...ranked].slice(0, limit);
}

/**
 * The score ladder, exported so a test can name a tier instead of a number.
 * An exact issue-key hit has no entry here because it is not scored -- it is
 * pinned above the ranking.
 */
export const QUICK_OPEN_SCORES = {
  titleExact: SCORE_TITLE_EXACT,
  titlePrefix: SCORE_TITLE_PREFIX,
  titleWord: SCORE_TITLE_WORD,
  titleSubstring: SCORE_TITLE_SUBSTRING,
  key: SCORE_KEY,
  subtitle: SCORE_SUBTITLE,
  detail: SCORE_DETAIL,
} as const;
