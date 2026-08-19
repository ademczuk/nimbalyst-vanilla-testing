/**
 * Main-process boundary validation for tracker batch requests.
 *
 * Fifty-item milestone assignment is the motivating operation. The 100-entry
 * ceiling leaves room for a second board-sized selection while bounding the
 * synchronous database, sync, inverse-write, and watcher work from one IPC call.
 */
export const MAX_TRACKER_ITEM_BATCH_ENTRIES = 100;
export const MAX_TRACKER_RELATIONSHIP_REINDEX_ITEMS = 100;

export interface TrackerItemBatchEntry {
  itemId: string;
  fileUpdates?: Record<string, unknown>;
  storeUpdates?: Record<string, unknown>;
  sharing?: 'personal' | 'team';
  draftByDefault?: boolean;
}

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateUpdateBag(
  entry: Record<string, unknown>,
  field: 'fileUpdates' | 'storeUpdates',
  index: number,
): ValidationResult<Record<string, unknown> | undefined> {
  const value = entry[field];
  if (value === undefined) return { ok: true, value: undefined };
  if (!isPlainRecord(value)) {
    return { ok: false, error: `entries[${index}].${field} must be a plain object` };
  }
  return { ok: true, value };
}

export function validateTrackerItemBatchPayload(payload: unknown): ValidationResult<TrackerItemBatchEntry[]> {
  if (!isPlainRecord(payload) || !Array.isArray(payload.entries)) {
    return { ok: false, error: 'update-tracker-items requires an entries array' };
  }
  if (payload.entries.length === 0) {
    return { ok: false, error: 'update-tracker-items requires at least one entry' };
  }
  if (payload.entries.length > MAX_TRACKER_ITEM_BATCH_ENTRIES) {
    return {
      ok: false,
      error: `update-tracker-items accepts at most ${MAX_TRACKER_ITEM_BATCH_ENTRIES} entries`,
    };
  }

  const entries: TrackerItemBatchEntry[] = [];
  for (let index = 0; index < payload.entries.length; index++) {
    const rawEntry = payload.entries[index];
    if (!isPlainRecord(rawEntry)) {
      return { ok: false, error: `entries[${index}] must be a plain object` };
    }

    const itemId = typeof rawEntry.itemId === 'string' ? rawEntry.itemId.trim() : '';
    if (!itemId) {
      return { ok: false, error: `entries[${index}].itemId must be a non-empty string` };
    }

    const fileUpdates = validateUpdateBag(rawEntry, 'fileUpdates', index);
    if (!fileUpdates.ok) return fileUpdates;
    const storeUpdates = validateUpdateBag(rawEntry, 'storeUpdates', index);
    if (!storeUpdates.ok) return storeUpdates;
    if (
      Object.keys(fileUpdates.value ?? {}).length === 0
      && Object.keys(storeUpdates.value ?? {}).length === 0
    ) {
      return { ok: false, error: `entries[${index}] must contain at least one update` };
    }

    if (
      rawEntry.sharing !== undefined
      && rawEntry.sharing !== 'personal'
      && rawEntry.sharing !== 'team'
    ) {
      return { ok: false, error: `entries[${index}].sharing must be personal or team` };
    }
    if (rawEntry.draftByDefault !== undefined && typeof rawEntry.draftByDefault !== 'boolean') {
      return { ok: false, error: `entries[${index}].draftByDefault must be a boolean` };
    }

    entries.push({
      itemId,
      fileUpdates: fileUpdates.value,
      storeUpdates: storeUpdates.value,
      sharing: rawEntry.sharing as 'personal' | 'team' | undefined,
      draftByDefault: rawEntry.draftByDefault as boolean | undefined,
    });
  }

  return { ok: true, value: entries };
}

export function validateRelationshipReindexPayload(payload: unknown): ValidationResult<string[]> {
  if (!isPlainRecord(payload)) {
    return { ok: false, error: 'Relationship reindex requires an item id or itemIds array' };
  }
  if (payload.itemId !== undefined && payload.itemIds !== undefined) {
    return { ok: false, error: 'Relationship reindex accepts itemId or itemIds, not both' };
  }

  const rawIds = payload.itemIds !== undefined ? payload.itemIds : [payload.itemId];
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    return { ok: false, error: 'Relationship reindex requires at least one item id' };
  }
  if (rawIds.length > MAX_TRACKER_RELATIONSHIP_REINDEX_ITEMS) {
    return {
      ok: false,
      error: `Relationship reindex accepts at most ${MAX_TRACKER_RELATIONSHIP_REINDEX_ITEMS} item ids`,
    };
  }

  const itemIds: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < rawIds.length; index++) {
    const itemId = typeof rawIds[index] === 'string' ? rawIds[index].trim() : '';
    if (!itemId) {
      return { ok: false, error: `itemIds[${index}] must be a non-empty string` };
    }
    if (!seen.has(itemId)) {
      seen.add(itemId);
      itemIds.push(itemId);
    }
  }

  return { ok: true, value: itemIds };
}
