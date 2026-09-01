/**
 * Build a tracker item's `customFields` bag from a stored JSONB `data` blob.
 *
 * Two storage shapes exist and BOTH must flatten to the same bag, or schema
 * columns render blank (NIM-863):
 *  - legacy/flat: custom fields sit at the top level of `data`
 *    (`data.prUrl`, `data.kanbanSortOrder`, ...).
 *  - nested: custom fields sit under a `data.customFields` sub-object
 *    (how synced / CLI-written items are stored).
 *
 * The nested case is the regression: if the raw `customFields` key is copied
 * through as-is, the item ends up with `customFields.customFields = {...}`, and
 * `trackerItemToRecord` skips the `customFields` key (it's a NON_FIELD_KEY), so
 * `record.fields.prUrl` is never set and the table column is empty.
 *
 * This helper lifts the entries of a nested `data.customFields` object up into
 * the returned bag (alongside any top-level extras), and never carries the raw
 * `customFields` key through.
 *
 * @param data   parsed JSONB `data` column for the row
 * @param known  keys already mapped onto first-class TrackerItem properties
 * @returns the flattened customFields bag, or undefined if empty
 */
/**
 * Identity keys that live in indexed columns and only there.
 *
 * Rows written before the identity keys became column-only still carry a second
 * copy inside `data`, and that copy is exactly the one that drifted against the
 * columns -- on this workspace 245 of them named a different item than their own
 * row did. Every converter reads the columns, so a blob copy can only ever be a
 * wrong shadow of them; sweeping one into `customFields` launders a known-wrong
 * key into a payload that already carries the right one.
 *
 * Every known-set passed to `extractItemCustomFields` must include these. The
 * write paths in TrackerPGLiteStore delete them from `data` on the way in, and
 * `stripColumnOnlyIdentityKeys` clears the ones already on disk.
 */
export const COLUMN_ONLY_IDENTITY_KEYS = ['issueNumber', 'issueKey', 'typeTags'] as const;

/**
 * Remove the column-only identity keys from a parsed `data` blob in place.
 * Returns true if anything was removed.
 */
export function stripColumnOnlyIdentityKeys(data: Record<string, unknown>): boolean {
  let changed = false;
  for (const key of COLUMN_ONLY_IDENTITY_KEYS) {
    if (key in data) {
      delete data[key];
      changed = true;
    }
  }
  return changed;
}

export function extractItemCustomFields(
  data: Record<string, unknown> | null | undefined,
  known: Set<string>,
): Record<string, unknown> | undefined {
  if (!data) return undefined;

  const extra: Record<string, unknown> = {};

  // Top-level extras (skip the nested customFields key -- handled below).
  for (const [k, v] of Object.entries(data)) {
    if (k === 'customFields') continue;
    if (!known.has(k) && v !== undefined) extra[k] = v;
  }

  // Lift the nested customFields bag up one level. It is the canonical bag, so
  // it wins over any same-named top-level extra.
  const nested = data.customFields;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    for (const [k, v] of Object.entries(nested as Record<string, unknown>)) {
      if (v !== undefined) extra[k] = v;
    }
  }

  return Object.keys(extra).length > 0 ? extra : undefined;
}
