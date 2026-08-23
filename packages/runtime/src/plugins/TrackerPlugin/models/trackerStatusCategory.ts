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

import { getRoleField, globalRegistry, type FieldOption } from './TrackerDataModel';

export type StatusCategory =
  /** Captured, not committed to. */
  | 'backlog'
  /** Committed, not begun. */
  | 'unstarted'
  /** In flight — including the whole review lane. */
  | 'started'
  /** Finished successfully. Counts toward progress. */
  | 'done'
  /** Abandoned. Leaves the progress denominator entirely. */
  | 'cancelled';

/** Every category, in lifecycle order. Board columns and pickers use this order. */
export const STATUS_CATEGORIES: readonly StatusCategory[] = [
  'backlog',
  'unstarted',
  'started',
  'done',
  'cancelled',
] as const;

/** The categories that mean "this item is closed". */
export const TERMINAL_CATEGORIES: ReadonlySet<StatusCategory> = new Set<StatusCategory>([
  'done',
  'cancelled',
]);

/** Human labels for the schema editor's category picker. */
export const STATUS_CATEGORY_LABELS: Record<StatusCategory, string> = {
  backlog: 'Backlog',
  unstarted: 'Unstarted',
  started: 'Started',
  done: 'Done',
  cancelled: 'Cancelled',
};

export function isStatusCategory(value: unknown): value is StatusCategory {
  return typeof value === 'string' && (STATUS_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Tier 2 of {@link resolveStatusCategory}: the legacy name table.
 *
 * This exists only for statuses with no declared category — custom types
 * authored before categories existed, and out-of-schema values a peer on a
 * different schema set sent us (which the validator preserves as a warning
 * rather than destroying). It is deliberately small and deliberately NOT the
 * mechanism; a status that reaches this table is one nobody has categorised yet.
 *
 * `approved` is absent on purpose. The old terminal list contained it, which is
 * exactly the bug that made collection progress overstate by the width of the
 * review lane.
 */
const LEGACY_CATEGORY_BY_NAME: Record<string, StatusCategory> = {
  // done
  'done': 'done',
  'completed': 'done',
  'complete': 'done',
  'closed': 'done',
  'resolved': 'done',
  'released': 'done',
  'shipped': 'done',
  'implemented': 'done',
  'decided': 'done',
  'fixed': 'done',
  // cancelled
  'cancelled': 'cancelled',
  'canceled': 'cancelled',
  'rejected': 'cancelled',
  'declined': 'cancelled',
  'abandoned': 'cancelled',
  'obsolete': 'cancelled',
  'superseded': 'cancelled',
  'duplicate': 'cancelled',
  'wont-do': 'cancelled',
  'wont-fix': 'cancelled',
  "won't-do": 'cancelled',
  "won't-fix": 'cancelled',
  'not-planned': 'cancelled',
  // in flight
  'in-progress': 'started',
  'in-development': 'started',
  'in-review': 'started',
  'changes-requested': 'started',
  'approved': 'started',
  'blocked': 'started',
  'active': 'started',
  // not begun
  'to-do': 'unstarted',
  'todo': 'unstarted',
  'open': 'unstarted',
  'planned': 'unstarted',
  'ready': 'unstarted',
  'ready-for-development': 'unstarted',
  // captured
  'draft': 'backlog',
  'new': 'backlog',
  'backlog': 'backlog',
  'proposed': 'backlog',
  'triage': 'backlog',
};

function normalize(status: string | null | undefined): string {
  return String(status ?? '').trim().toLowerCase();
}

/** The workflow-status field for a type, honouring the `workflowStatus` role. */
export function getWorkflowStatusFieldName(type: string): string {
  const model = globalRegistry.get(type);
  // A schema that declares no roles still conventionally uses `status`; this
  // mirrors the fallback every other accessor in the plugin uses.
  return (model && getRoleField(model, 'workflowStatus')) ?? 'status';
}

/** The declared options of a type's workflow-status field, in schema order. */
export function getWorkflowStatusOptions(type: string): FieldOption[] {
  const model = globalRegistry.get(type);
  if (!model) return [];
  const fieldName = getWorkflowStatusFieldName(type);
  const options = model.fields.find(f => f.name === fieldName)?.options ?? [];
  // Legacy schemas may carry bare strings where FieldOption is expected.
  return options.map(option => (
    typeof option === 'string' ? { value: option, label: option } : option
  ));
}

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
export function resolveStatusCategory(
  type: string,
  statusValue: string | null | undefined,
): StatusCategory {
  const value = normalize(statusValue);
  if (!value) return 'unstarted';

  const known = resolveKnownStatusCategory(type, value);
  if (known) return known;

  const model = globalRegistry.get(type);
  const options = getWorkflowStatusOptions(type);
  const field = model?.fields.find(f => f.name === getWorkflowStatusFieldName(type));
  const initial = normalize(
    (typeof field?.default === 'string' ? field.default : undefined) ?? options[0]?.value,
  );
  return initial && initial === value ? 'unstarted' : 'started';
}

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
export function resolveKnownStatusCategory(
  type: string,
  statusValue: string | null | undefined,
): StatusCategory | undefined {
  const value = normalize(statusValue);
  if (!value) return undefined;

  const declared = getWorkflowStatusOptions(type)
    .find(option => normalize(option.value) === value)?.category;
  if (isStatusCategory(declared)) return declared;

  return LEGACY_CATEGORY_BY_NAME[value];
}

/** Whether an item at this status is closed — done or cancelled. */
export function isTerminalStatus(type: string, statusValue: string | null | undefined): boolean {
  return TERMINAL_CATEGORIES.has(resolveStatusCategory(type, statusValue));
}

/** Whether an item at this status finished successfully. */
export function isDoneStatus(type: string, statusValue: string | null | undefined): boolean {
  return resolveStatusCategory(type, statusValue) === 'done';
}

/** Whether an item at this status was abandoned rather than finished. */
export function isCancelledStatus(type: string, statusValue: string | null | undefined): boolean {
  return resolveStatusCategory(type, statusValue) === 'cancelled';
}

/**
 * Every status value across the given types that falls in one of `categories`.
 *
 * Used to expand a category selection into the concrete values a board column
 * or a value-based query needs. Types that declare no matching status simply
 * contribute nothing.
 */
export function statusValuesInCategories(
  types: readonly string[],
  categories: readonly StatusCategory[],
): Set<string> {
  const wanted = new Set<StatusCategory>(categories);
  const out = new Set<string>();
  for (const type of types) {
    for (const option of getWorkflowStatusOptions(type)) {
      if (wanted.has(resolveStatusCategory(type, option.value))) out.add(option.value);
    }
  }
  return out;
}

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
export const STATUS_CATEGORY_FILTER_FIELD = 'statusCategory';

/** Synthetic dependency-readiness field shared by tracker filter accessors. */
export const READINESS_FILTER_FIELD = 'readiness';

/** The categories an "open work" scope keeps. */
export const OPEN_CATEGORIES: readonly StatusCategory[] = ['backlog', 'unstarted', 'started'];

/** The clause a scope lowers to, or null for a scope that filters nothing. */
export function statusScopeClause(
  scope: 'open' | 'all' | 'closed',
): { field: string; op: 'in' | 'not-in'; value: StatusCategory[] } | null {
  if (scope === 'all') return null;
  return {
    field: STATUS_CATEGORY_FILTER_FIELD,
    op: scope === 'open' ? 'not-in' : 'in',
    value: [...TERMINAL_CATEGORIES],
  };
}

/**
 * The category of an item, for the filter accessors.
 *
 * Both the renderer's `getTrackerFilterValue` and the MCP list handler's
 * `getFieldValue` route through here rather than each resolving the field
 * themselves — they read different item shapes (schema `fields` bag vs the
 * flattened tool shape), and two copies of this lookup would drift.
 */
export function statusCategoryOfItem(
  type: string,
  readField: (fieldName: string) => unknown,
): StatusCategory {
  const status = readField(getWorkflowStatusFieldName(type));
  return resolveStatusCategory(type, typeof status === 'string' ? status : undefined);
}

/**
 * The status a type closes into, for callers that must *write* a terminal
 * status rather than test one (the commit linker, bulk "mark done" actions).
 *
 * Returns the first `done`-category option in schema order, or undefined for a
 * type that has no way to finish — `idea` is exactly that: an accepted idea is
 * still in flight, so it ends either cancelled or converted, never "done".
 * Callers must handle undefined rather than falling back to the string `'done'`,
 * which is how an out-of-schema status got written onto plans.
 */
export function getDoneStatusValue(type: string): string | undefined {
  return getWorkflowStatusOptions(type)
    .find(option => resolveStatusCategory(type, option.value) === 'done')
    ?.value;
}
