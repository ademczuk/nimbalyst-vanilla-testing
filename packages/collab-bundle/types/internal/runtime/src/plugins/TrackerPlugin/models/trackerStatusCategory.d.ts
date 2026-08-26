/**
 * Where a workflow status sits in the lifecycle — the one place the product
 * answers "is this item finished?".
 *
 * Before this module, terminality was a hardcoded list of status *names* in
 * `trackerCollections`, and three other lists elsewhere disagreed with it. That
 * arrangement cannot be right for more than one schema at a time: `plan` closes
 * as `completed`, `decision` as `decided`/`implemented`, `idea` as `rejected` —
 * none of which the name list knew — while `approved`, a review-lane state a
 * human has to promote past, was counted as done.
 *
 * So a status now *declares* its category (see {@link FieldOption.category}) and
 * everything else derives. Terminal is not stored; it is `done | cancelled`.
 *
 * The split inside terminal is load-bearing, not cosmetic. Finished work counts
 * toward progress; abandoned work leaves the denominator entirely, which is what
 * lets a milestone containing a cancelled item still reach 100%.
 *
 * Pure and I/O-free: the registry is read through the same `globalRegistry` the
 * other model modules use, so the renderer, the MCP tools and the CLI all
 * resolve identically.
 */
import { type FieldOption } from './TrackerDataModel';
export type StatusCategory = 
/** Captured, not committed to. */
'backlog'
/** Committed, not begun. */
 | 'unstarted'
/** In flight — including the whole review lane. */
 | 'started'
/** Finished successfully. Counts toward progress. */
 | 'done'
/** Abandoned. Leaves the progress denominator entirely. */
 | 'cancelled';
/** Every category, in lifecycle order. Board columns and pickers use this order. */
export declare const STATUS_CATEGORIES: readonly StatusCategory[];
/** The categories that mean "this item is closed". */
export declare const TERMINAL_CATEGORIES: ReadonlySet<StatusCategory>;
/** Human labels for the schema editor's category picker. */
export declare const STATUS_CATEGORY_LABELS: Record<StatusCategory, string>;
export declare function isStatusCategory(value: unknown): value is StatusCategory;
/** The workflow-status field for a type, honouring the `workflowStatus` role. */
export declare function getWorkflowStatusFieldName(type: string): string;
/** The declared options of a type's workflow-status field, in schema order. */
export declare function getWorkflowStatusOptions(type: string): FieldOption[];
/**
 * The category of one status value on one tracker type.
 *
 * Resolution tiers, in order:
 *
 *   1. **Declared** — the option's `category`. Always wins.
 *   2. **Legacy name table** — only for values with no declared category.
 *   3. **Structural** — the field's default (or first) option is `unstarted`;
 *      anything else is `started`.
 *
 * Tier 3 is **never terminal**, and that asymmetry is the point. Guessing
 * terminal for a status nobody has categorised hides an open item, which is data
 * loss; guessing open shows a closed one, which is a papercut. When in doubt,
 * the item stays visible.
 */
export declare function resolveStatusCategory(type: string, statusValue: string | null | undefined): StatusCategory;
/**
 * Tiers 1 and 2 only: the category if it is DECLARED or recognised by name,
 * and `undefined` for a status nobody has classified.
 *
 * Callers that ask "is this closed?" want the total function above -- an
 * unclassified status has to answer something, and open is the safe answer.
 * Callers that ask "what does this status MEAN?" -- the reference chip's colour,
 * say -- want this one, because for those the honest answer to an unrecognised
 * status is "no idea", rendered neutral, not a guess rendered as in-progress.
 */
export declare function resolveKnownStatusCategory(type: string, statusValue: string | null | undefined): StatusCategory | undefined;
/** Whether an item at this status is closed — done or cancelled. */
export declare function isTerminalStatus(type: string, statusValue: string | null | undefined): boolean;
/** Whether an item at this status finished successfully. */
export declare function isDoneStatus(type: string, statusValue: string | null | undefined): boolean;
/** Whether an item at this status was abandoned rather than finished. */
export declare function isCancelledStatus(type: string, statusValue: string | null | undefined): boolean;
/**
 * Every status value across the given types that falls in one of `categories`.
 *
 * Used to expand a category selection into the concrete values a board column
 * or a value-based query needs. Types that declare no matching status simply
 * contribute nothing.
 */
export declare function statusValuesInCategories(types: readonly string[], categories: readonly StatusCategory[]): Set<string>;
/**
 * The filter field name that exposes the lifecycle category to the shared
 * `{field, op, value}` language.
 *
 * This is the whole reason "hide closed work" is expressible at all. A clause
 * over the status *value* can only ever be written per type — `done` for a bug,
 * `completed` for a plan, `rejected` for an idea — so in the all-types view no
 * single clause exists. A clause over the category is uniform:
 *
 *   { field: 'statusCategory', op: 'not-in', value: ['done', 'cancelled'] }
 *
 * and it therefore works identically in saved views, the grid's column filters,
 * the omnibox, `tracker_list --where`, and the CLI.
 */
export declare const STATUS_CATEGORY_FILTER_FIELD = "statusCategory";
/** Synthetic dependency-readiness field shared by tracker filter accessors. */
export declare const READINESS_FILTER_FIELD = "readiness";
/** The categories an "open work" scope keeps. */
export declare const OPEN_CATEGORIES: readonly StatusCategory[];
/** The clause a scope lowers to, or null for a scope that filters nothing. */
export declare function statusScopeClause(scope: 'open' | 'all' | 'closed'): {
    field: string;
    op: 'in' | 'not-in';
    value: StatusCategory[];
} | null;
/**
 * The category of an item, for the filter accessors.
 *
 * Both the renderer's `getTrackerFilterValue` and the MCP list handler's
 * `getFieldValue` route through here rather than each resolving the field
 * themselves — they read different item shapes (schema `fields` bag vs the
 * flattened tool shape), and two copies of this lookup would drift.
 */
export declare function statusCategoryOfItem(type: string, readField: (fieldName: string) => unknown): StatusCategory;
/**
 * The status value a type uses to express a lifecycle category, for callers that
 * must *write* a status rather than test one.
 *
 * This is the inverse of {@link resolveStatusCategory}, and it is the only way to
 * apply one intent ("close these") across a mixed-type selection: a bug closes as
 * `done`, a plan as `completed`, an idea as `rejected`. Returns the first matching
 * option in schema order, and `undefined` for a type that cannot express the
 * category at all — `idea` has no `done`, `customer` has no lifecycle whatsoever.
 *
 * Callers must handle `undefined` rather than falling back to the category name,
 * which is how an out-of-schema status got written onto plans.
 */
export declare function getStatusValueForCategory(type: string, category: StatusCategory): string | undefined;
/**
 * The status a type closes into (the commit linker, bulk "mark done" actions).
 */
export declare function getDoneStatusValue(type: string): string | undefined;
