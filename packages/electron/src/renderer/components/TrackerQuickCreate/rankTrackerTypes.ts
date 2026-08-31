/**
 * Ordering for the quick-create type picker.
 *
 * A workspace can define dozens of creatable types, so the picker is a filter
 * over a list rather than a row of pills. Ranking is pure over (models, query,
 * recents) so the ordering rules are assertable without rendering: with no
 * query the most-recently-used types come first, and with a query the best
 * textual match wins, with recency only breaking ties.
 */

import { fuzzyMatch } from '@nimbalyst/runtime/utils/fuzzyMatch';
import type { TrackerDataModel } from '@nimbalyst/runtime/plugins/TrackerPlugin/models/TrackerDataModel';

export interface TrackerTypeChoice {
  model: TrackerDataModel;
  /** Indices into `model.displayName` to highlight. Empty when the query is empty. */
  matchedIndices: number[];
}

/**
 * @param models    Creatable, non-archived tracker models.
 * @param query     The picker's filter text; empty shows everything.
 * @param recentTypes Type names in most-recently-used order.
 */
export function rankTrackerTypes(
  models: TrackerDataModel[],
  query: string,
  recentTypes: string[],
): TrackerTypeChoice[] {
  const recency = new Map(recentTypes.map((type, index) => [type, index]));
  const rankOf = (model: TrackerDataModel) => recency.get(model.type) ?? Number.MAX_SAFE_INTEGER;

  const trimmed = query.trim();
  if (!trimmed) {
    return [...models]
      .sort((a, b) => rankOf(a) - rankOf(b) || a.displayName.localeCompare(b.displayName))
      .map((model) => ({ model, matchedIndices: [] }));
  }

  const scored: Array<{ choice: TrackerTypeChoice; score: number }> = [];
  for (const model of models) {
    // The display name is what is on screen, so it owns the highlight. The type
    // slug still matches — someone who knows a type as `qc-bug` should find it.
    const byName = fuzzyMatch(trimmed, model.displayName);
    const bySlug = fuzzyMatch(trimmed, model.type);
    if (!byName.matches && !bySlug.matches) continue;
    scored.push({
      choice: {
        model,
        matchedIndices: byName.matches ? byName.matchedIndices : [],
      },
      score: Math.max(byName.score, bySlug.score * 0.9),
    });
  }

  return scored
    .sort(
      (a, b) =>
        b.score - a.score ||
        rankOf(a.choice.model) - rankOf(b.choice.model) ||
        a.choice.model.displayName.localeCompare(b.choice.model.displayName),
    )
    .map((entry) => entry.choice);
}
