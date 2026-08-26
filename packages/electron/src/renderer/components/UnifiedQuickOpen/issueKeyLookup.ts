/**
 * Tracker matching for quick open, and the desktop-only half of it.
 *
 * The Memory pane is a pure embedding search, so a query like "NIM-2374" or a
 * bare "2374" ranks by meaning and never resolves to the item the user is
 * actually naming. The key parser, the key predicate and the plain-text
 * predicate now live in `@nimbalyst/collab-client/quick-open` so the browser
 * console's palette resolves a key the same way this dialog does; they are
 * re-exported here because that is the specifier this dialog and its test have
 * always imported.
 *
 * What stays: shaping a match into a `SemanticSearchResult`. That type belongs
 * to the local search engine, which a browser tab has no access to.
 */

import {
  findTrackersByIssueKey,
  matchesTrackerText,
  parseIssueKeyQuery,
} from '@nimbalyst/collab-client/quick-open';
import type { TrackerItem } from '@nimbalyst/runtime/core/DocumentService';

export { findTrackersByIssueKey, matchesTrackerText, parseIssueKeyQuery };
export type { ParsedIssueKeyQuery } from '@nimbalyst/collab-client/quick-open';

/**
 * A search result, plus the tracker type when we know it. The engine's records
 * carry only `refType: 'tracker'`, so a semantic hit cannot say whether it is a
 * bug or a decision; an exact key match came from the item itself and can.
 */
export type QuickOpenSearchResult = SemanticSearchResult & {
  trackerType?: string;
};

/** Shape an exact key match like a search result so the pane renders it inline. */
export function trackerToSearchResult(item: TrackerItem): QuickOpenSearchResult {
  return {
    refType: 'tracker',
    refId: item.id,
    sourceClass: 'trackers',
    sourcePath: item.issueKey ?? item.id,
    // A frontmatter-projected item can arrive with no title; the pane falls
    // back to sourcePath rather than rendering a blank row.
    title: item.title ?? '',
    snippet: item.issueKey ?? '',
    score: 1,
    // Exact key hit, not an embedding hit — no "semantic match" marker.
    signals: { dense: false, sparse: true },
    trackerType: item.type,
  };
}

/** Exact key matches first, then the semantic results minus any duplicates. */
export function mergeIssueKeyMatches(
  matches: readonly TrackerItem[],
  semantic: readonly SemanticSearchResult[],
): QuickOpenSearchResult[] {
  if (matches.length === 0) return [...semantic];
  const matchedIds = new Set(matches.map((item) => item.id));
  return [
    ...matches.map(trackerToSearchResult),
    ...semantic.filter(
      (result) => !(result.refType === 'tracker' && matchedIds.has(result.refId)),
    ),
  ];
}
