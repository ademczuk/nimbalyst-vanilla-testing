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
import type { TrackerFilterChip } from './model';
import type { TrackerItemFilterDefinition } from './trackerSavedViews';
/** Filter fields whose value only exists in a host's personal lane. */
export declare const PERSONAL_TRACKER_FILTER_FIELDS: ReadonlySet<string>;
/** Legacy sidebar chips that resolve to a personal-lane clause. */
export declare const PERSONAL_TRACKER_FILTER_CHIPS: ReadonlySet<TrackerFilterChip>;
export interface PersonalViewClause {
    /** Where the clause was written: a legacy chip or an inspectable field clause. */
    source: 'chip' | 'clause';
    /** The personal field the clause reads. */
    field: 'favorite' | 'viewed';
    /** Short human phrase for the marker, e.g. "your favorites". */
    label: string;
}
/**
 * Every personal-lane clause in a view definition, deduplicated by field.
 *
 * Empty for the overwhelmingly common case, which is what makes it cheap to call
 * on every render of every view.
 */
export declare function findPersonalViewClauses(definition: Pick<TrackerItemFilterDefinition, 'activeFilters' | 'columnFilters'>): PersonalViewClause[];
/**
 * The same definition with every personal-lane clause removed.
 *
 * Returns the original object when there is nothing to strip, so callers can use
 * referential equality to skip re-filtering.
 */
export declare function withoutPersonalViewClauses<T extends TrackerItemFilterDefinition>(definition: T): T;
/** One sentence naming what the host could not evaluate. */
export declare function describePersonalViewClauses(clauses: readonly PersonalViewClause[]): string;
