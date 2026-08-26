/**
 * Personal-lane clauses inside a team-shared saved view.
 *
 * A saved view is a team-owned object, but nothing stops someone building one on
 * top of a filter that only means something to them: `favorite` is their star
 * list and `viewed` is their own open history, and both ride the personal lane
 * behind a personal JWT. A host that has no personal lane -- the browser console
 * -- cannot answer either predicate.
 *
 * Evaluating them anyway is the trap. `getTrackerFilterValue` resolves `favorite`
 * to `false` and `viewed` to `undefined` when the context carries no personal
 * data, so `favorite = true` matches nothing and the view renders **zero rows**
 * that look like a sync failure rather than a missing capability. Silently
 * deleting the clause is the opposite failure: the view then shows more rows than
 * its author meant it to, with nothing on screen to say so.
 *
 * So: strip the clause so the rest of the view still answers, and hand the caller
 * a description of exactly what was dropped so it can be said out loud.
 */

import type { TrackerFieldFilter, TrackerFilterSet } from '@nimbalyst/runtime/plugins/TrackerPlugin/models';
import type { TrackerFilterChip } from './model';
import type { TrackerItemFilterDefinition } from './trackerSavedViews';

/** Filter fields whose value only exists in a host's personal lane. */
export const PERSONAL_TRACKER_FILTER_FIELDS: ReadonlySet<string> = new Set(['favorite', 'viewed']);

/** Legacy sidebar chips that resolve to a personal-lane clause. */
export const PERSONAL_TRACKER_FILTER_CHIPS: ReadonlySet<TrackerFilterChip> = new Set<TrackerFilterChip>([
  'favorites',
  'recently-viewed',
]);

export interface PersonalViewClause {
  /** Where the clause was written: a legacy chip or an inspectable field clause. */
  source: 'chip' | 'clause';
  /** The personal field the clause reads. */
  field: 'favorite' | 'viewed';
  /** Short human phrase for the marker, e.g. "your favorites". */
  label: string;
}

const FIELD_LABELS: Record<PersonalViewClause['field'], string> = {
  favorite: 'your favorites',
  viewed: 'what you recently opened',
};

function personalFieldOf(field: string): PersonalViewClause['field'] | null {
  return PERSONAL_TRACKER_FILTER_FIELDS.has(field) ? (field as PersonalViewClause['field']) : null;
}

/**
 * Every personal-lane clause in a view definition, deduplicated by field.
 *
 * Empty for the overwhelmingly common case, which is what makes it cheap to call
 * on every render of every view.
 */
export function findPersonalViewClauses(
  definition: Pick<TrackerItemFilterDefinition, 'activeFilters' | 'columnFilters'>,
): PersonalViewClause[] {
  const found = new Map<PersonalViewClause['field'], PersonalViewClause>();

  for (const chip of definition.activeFilters ?? []) {
    if (!PERSONAL_TRACKER_FILTER_CHIPS.has(chip)) continue;
    const field = chip === 'favorites' ? 'favorite' : 'viewed';
    if (!found.has(field)) found.set(field, { source: 'chip', field, label: FIELD_LABELS[field] });
  }

  for (const clause of definition.columnFilters?.clauses ?? []) {
    const field = personalFieldOf(clause.field);
    if (field && !found.has(field)) {
      found.set(field, { source: 'clause', field, label: FIELD_LABELS[field] });
    }
  }

  return [...found.values()];
}

/**
 * The same definition with every personal-lane clause removed.
 *
 * Returns the original object when there is nothing to strip, so callers can use
 * referential equality to skip re-filtering.
 */
export function withoutPersonalViewClauses<T extends TrackerItemFilterDefinition>(definition: T): T {
  const activeFilters = (definition.activeFilters ?? []).filter(
    (chip) => !PERSONAL_TRACKER_FILTER_CHIPS.has(chip),
  );
  const clauses: TrackerFieldFilter[] = (definition.columnFilters?.clauses ?? []).filter(
    (clause) => personalFieldOf(clause.field) === null,
  );

  const chipsUnchanged = activeFilters.length === (definition.activeFilters ?? []).length;
  const clausesUnchanged = clauses.length === (definition.columnFilters?.clauses ?? []).length;
  if (chipsUnchanged && clausesUnchanged) return definition;

  const columnFilters: TrackerFilterSet | null = definition.columnFilters
    ? { ...definition.columnFilters, clauses }
    : null;
  return { ...definition, activeFilters, columnFilters };
}

/** One sentence naming what the host could not evaluate. */
export function describePersonalViewClauses(clauses: readonly PersonalViewClause[]): string {
  if (clauses.length === 0) return '';
  const phrases = clauses.map((clause) => clause.label);
  const joined = phrases.length === 1
    ? phrases[0]
    : `${phrases.slice(0, -1).join(', ')} and ${phrases[phrases.length - 1]}`;
  return `This view also filters on ${joined}, which only exists in the desktop app. Those rows are not filtered out here.`;
}
