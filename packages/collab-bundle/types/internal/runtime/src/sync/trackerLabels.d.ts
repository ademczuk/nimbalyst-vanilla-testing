/**
 * Add-wins CRDT for tracker labels.
 *
 * `TrackerItemPayload.labels` is `Record<entryId, LabelEntry>` -- per-element
 * stable IDs let concurrent additions survive across peers (D3 of the
 * tracker-sync redesign). Removals tombstone the matching entries; on merge
 * a tombstone on one side wins over a live entry on the other side AT THE
 * SAME KEY. Different keys with the same `value` (two clients each adding
 * "bug") both survive -- that's the add-wins property.
 *
 * The on-screen value list is a projection of the map: unique `value`s
 * from non-tombstoned entries. The legacy `labels: string[]` API is kept;
 * callers diff-update against the prior map via `applyLabelDiff`.
 */
import type { LabelEntry } from './trackerProtocol';
export type LabelsMap = Record<string, LabelEntry>;
/**
 * Project a CRDT labels map to the user-facing unique value list. Tombstoned
 * entries are excluded; duplicate values from different IDs collapse.
 */
export declare function projectLabelsToValues(map: LabelsMap | undefined): string[];
/**
 * Diff a user-facing string[] update against the prior CRDT map. Values
 * present in `newValues` but not represented by a live entry become fresh
 * additions (new IDs). Values represented by live entries but missing from
 * `newValues` get all their live entries tombstoned. Existing tombstones
 * are preserved verbatim.
 *
 * Returns the next CRDT map. The caller persists it; the producer ships it.
 */
export declare function applyLabelDiff(prior: LabelsMap | undefined, newValues: string[] | undefined, newIdFactory?: () => string): LabelsMap;
/**
 * Union two CRDT label maps. Per-key, a tombstone on either side wins
 * (remove-wins-by-key); keys present on only one side carry through
 * unchanged. The result is the merged add-wins set both peers should
 * converge on once the delta has propagated in both directions.
 */
export declare function mergeLabelMaps(local: LabelsMap | undefined, incoming: LabelsMap | undefined): LabelsMap;
/**
 * Coerce the `labels` value read out of a tracker row's JSONB `data`
 * column into the `string[] | undefined` shape the rest of the pipeline
 * (notably `applyLabelDiff`) expects.
 *
 * Why this exists: some legacy rows were written with `data.labels`
 * double-stringified -- i.e. the value of `labels` is a JSON-encoded
 * string like `"[\"editor\", \"lexical\"]"` instead of a JSON array.
 * That broke the backfill path on every startup (`(newValues ?? []).filter
 * is not a function`), the items never got a `sync_id`, and they re-entered
 * the candidate set on every reconnect.
 *
 * Fix at the DB-to-domain boundary so the wrong shape can never reach
 * the labels CRDT. New writes go through the typed payload path and
 * produce `string[]`, so this is a one-way legacy compatibility shim.
 */
export declare function normalizeLegacyLabelValues(raw: unknown): string[] | undefined;
