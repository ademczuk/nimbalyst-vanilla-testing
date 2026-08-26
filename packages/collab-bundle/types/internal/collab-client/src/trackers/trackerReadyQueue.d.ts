/** Pure built-in Ready view and dependency-leverage ordering. */
import type { TrackerRecord } from '../../../runtime/src/core/TrackerRecord';
import type { Readiness } from '../../../runtime/src/plugins/TrackerPlugin/models/trackerReadiness';
import { type SavedView } from './trackerSavedViews';
/** Stable id of the built-in view; never persisted, never shared. */
export declare const READY_SAVED_VIEW_ID = "builtin:ready";
/**
 * Sentinel `sortBy` marking the leverage order. It is not a column: the value
 * it ranks by is derived from the dependency graph rather than read off a
 * record, so the surfaces render it as a preserved order instead of routing it
 * through the shared cell comparator.
 */
export declare const READINESS_LEVERAGE_SORT = "readinessLeverage";
/**
 * Order a queue by leverage: how many other items each one releases, then by
 * priority, then by title so the same corpus always produces the same rows in
 * the same places.
 *
 * `unblocks` counts only the dependents this item is the *last* open blocker
 * for, so a high number really does mean "closing this moves the most work".
 */
export declare function orderTrackerItemsByLeverage(items: readonly TrackerRecord[], readinessByItemId: ReadonlyMap<string, Readiness>): TrackerRecord[];
/**
 * The built-in Ready view: open work whose every declared blocker is closed,
 * highest-leverage first. It ships as an ordinary saved view so it lives in the
 * sidebar section people already use rather than behind a new surface.
 */
export declare function createReadySavedView(): SavedView;
/**
 * The list the sidebar renders. A persisted view can never shadow a built-in
 * id, so a stale local copy from an older build cannot resurrect itself as a
 * second, editable "Ready".
 */
export declare function withBuiltInSavedViews(views: readonly SavedView[]): SavedView[];
