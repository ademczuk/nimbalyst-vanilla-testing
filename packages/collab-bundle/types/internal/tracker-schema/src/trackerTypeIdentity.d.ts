/**
 * Built-in tracker item type identity — the icon and accent color for `bug`,
 * `task`, `decision` and friends.
 *
 * This lives on its own, with no imports, because two very different surfaces
 * need it and only one of them can afford the tracker plugin:
 *
 * - The tracker table (`trackerColumns.ts`), which consults `globalRegistry`
 *   first so an extension-registered type wins, then falls back to here.
 * - The messaging Inbox in the organization window, which renders a delivery
 *   about a tracker item it may never have synced. There is no registry there
 *   and no item to read — only the type name the delivery carried — so the
 *   built-in map is the whole answer.
 *
 * Keeping one copy is the point: a duplicated map drifts silently the moment a
 * type is added, and the drift shows up as the wrong icon rather than an error.
 */
export declare const DEFAULT_TRACKER_TYPE_ICONS: Readonly<Record<string, string>>;
export declare const DEFAULT_TRACKER_TYPE_COLORS: Readonly<Record<string, string>>;
/** Icon for a built-in tracker type; `label` for anything unrecognized. */
export declare function defaultTrackerTypeIcon(type: string): string;
/** Accent for a built-in tracker type; neutral gray for anything unrecognized. */
export declare function defaultTrackerTypeColor(type: string): string;
