/**
 * The built-in "Ready" saved view and the leverage ordering behind it.
 *
 * Pure and side-effect free so the ordering can be tested without React: the
 * whole point of the view is that the row at the top is the one worth starting,
 * and that is a claim about a comparator, not about pixels.
 */

import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import { getRecordPriority, getRecordTitle } from '@nimbalyst/runtime/plugins/TrackerPlugin/trackerRecordAccessors';
import { READINESS_FILTER_FIELD } from '@nimbalyst/runtime/plugins/TrackerPlugin/models/trackerStatusCategory';
import type { Readiness } from '@nimbalyst/runtime/plugins/TrackerPlugin/models/trackerReadiness';
import { createDefaultViewDefinition, type SavedView } from './trackerSavedViews';

/** Stable id of the built-in view; never persisted, never shared. */
export const READY_SAVED_VIEW_ID = 'builtin:ready';

/**
 * Sentinel `sortBy` marking the leverage order. It is not a column: the value
 * it ranks by is derived from the dependency graph rather than read off a
 * record, so the surfaces render it as a preserved order instead of routing it
 * through the shared cell comparator.
 */
export const READINESS_LEVERAGE_SORT = 'readinessLeverage';

/** Priority ordering, most urgent first. Anything unset sorts after `low`. */
const PRIORITY_RANK = new Map<string, number>([
  ['critical', 0],
  ['high', 1],
  ['medium', 2],
  ['low', 3],
]);

function priorityRank(record: TrackerRecord): number {
  return PRIORITY_RANK.get(getRecordPriority(record)) ?? 4;
}

/**
 * Order a queue by leverage: how many other items each one releases, then by
 * priority, then by title so the same corpus always produces the same rows in
 * the same places.
 *
 * `unblocks` counts only the dependents this item is the *last* open blocker
 * for, so a high number really does mean "closing this moves the most work".
 */
export function orderTrackerItemsByLeverage(
  items: readonly TrackerRecord[],
  readinessByItemId: ReadonlyMap<string, Readiness>,
): TrackerRecord[] {
  return [...items].sort((left, right) => {
    const leftUnblocks = readinessByItemId.get(left.id)?.unblocks ?? 0;
    const rightUnblocks = readinessByItemId.get(right.id)?.unblocks ?? 0;
    if (leftUnblocks !== rightUnblocks) return rightUnblocks - leftUnblocks;

    const leftPriority = priorityRank(left);
    const rightPriority = priorityRank(right);
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;

    return getRecordTitle(left).localeCompare(getRecordTitle(right));
  });
}

/**
 * The built-in Ready view: open work whose every declared blocker is closed,
 * highest-leverage first. It ships as an ordinary saved view so it lives in the
 * sidebar section people already use rather than behind a new surface.
 */
export function createReadySavedView(): SavedView {
  return {
    id: READY_SAVED_VIEW_ID,
    name: 'Ready',
    builtIn: true,
    definition: {
      ...createDefaultViewDefinition(),
      viewMode: 'list',
      statusScope: 'open',
      sortBy: READINESS_LEVERAGE_SORT,
      sortDirection: 'desc',
      columnFilters: {
        combinator: 'and',
        clauses: [{ field: READINESS_FILTER_FIELD, op: '=', value: 'ready' }],
      },
    },
  };
}

/**
 * The list the sidebar renders. A persisted view can never shadow a built-in
 * id, so a stale local copy from an older build cannot resurrect itself as a
 * second, editable "Ready".
 */
export function withBuiltInSavedViews(views: readonly SavedView[]): SavedView[] {
  return [
    createReadySavedView(),
    ...views.filter((view) => view.id !== READY_SAVED_VIEW_ID),
  ];
}
