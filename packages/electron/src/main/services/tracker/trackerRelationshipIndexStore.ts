/**
 * Local-only derived relationship index (Epic C Phase 2).
 *
 * Relationship FIELD values are canonical and sync on the metadata socket like
 * `labels`; this store maintains the `tracker_relationship_index` projection of
 * those values so reverse lookup ("what links to X?") and backlinks are a single
 * indexed query instead of a full scan. The index is NEVER synced — it is
 * rebuilt locally from item JSON whenever an item is written.
 *
 * All ops are best-effort and injectable (`dbOverride`) so they unit-test
 * against a real in-memory SQLite without the global app database.
 */
import type { FieldDefinition, RelationshipEdge } from '@nimbalyst/runtime/plugins/TrackerPlugin/models';
import { deriveRelationshipEdges } from '@nimbalyst/runtime/plugins/TrackerPlugin/models';
import { getDatabase } from '../../database/initialize';
import { logger } from '../../utils/logger';
import { flattenDataForRead } from './relationshipFieldStorage';

export interface RelationshipIndexDb {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] } | unknown>;
}

function edgeId(workspace: string, sourceItemId: string, fieldId: string, targetItemId: string): string {
  return `${workspace}|${sourceItemId}|${fieldId}|${targetItemId}`;
}

/** A row read back from the index. */
export interface RelationshipIndexRow {
  sourceItemId: string;
  sourceFieldId: string;
  relationshipTypeKey: string | null;
  targetItemId: string;
  targetTrackerType: string | null;
  metadata: Record<string, unknown>;
}

export interface RelationshipReindexItem {
  workspace: string;
  sourceItemId: string;
  fields: Record<string, unknown> | undefined;
  fieldDefs: FieldDefinition[];
  sourceUpdatedAt: string | null;
}

function rowsOf(result: unknown): any[] {
  const r = result as { rows?: unknown[] } | undefined;
  return Array.isArray(r?.rows) ? (r!.rows as any[]) : [];
}

/** PGLite JSONB returns an object; SQLite TEXT returns a string (DATABASE.md). */
function parseMeta(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value === 'string' && value) {
    try { return JSON.parse(value); } catch { return {}; }
  }
  return {};
}

async function upsertRelationshipEdges(
  workspace: string,
  sourceItemId: string,
  edges: RelationshipEdge[],
  sourceUpdatedAt: string | null,
  db: RelationshipIndexDb,
): Promise<void> {
  for (const e of edges) {
    await db.query(
      `INSERT INTO tracker_relationship_index
         (id, workspace, source_item_id, source_field_id, relationship_type_key,
          target_item_id, target_tracker_type, source_updated_at, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (workspace, source_item_id, source_field_id, target_item_id) DO UPDATE
         SET relationship_type_key = EXCLUDED.relationship_type_key,
             target_tracker_type   = EXCLUDED.target_tracker_type,
             source_updated_at     = EXCLUDED.source_updated_at,
             metadata              = EXCLUDED.metadata`,
      [
        edgeId(workspace, sourceItemId, e.sourceFieldId, e.targetItemId),
        workspace,
        sourceItemId,
        e.sourceFieldId,
        e.relationshipTypeKey ?? null,
        e.targetItemId,
        e.targetTrackerType ?? null,
        sourceUpdatedAt,
        JSON.stringify(e.metadata ?? {}),
      ],
    );
  }
}

/**
 * Replace ALL outgoing edges for one source item with `edges` (delete-then-
 * insert). Called after an item write; idempotent and safe to re-run.
 */
export async function rebuildItemRelationships(
  workspace: string,
  sourceItemId: string,
  edges: RelationshipEdge[],
  sourceUpdatedAt: string | null,
  dbOverride?: RelationshipIndexDb,
): Promise<void> {
  try {
    const db = dbOverride ?? (getDatabase() as RelationshipIndexDb | null);
    if (!db) return;
    await db.query(
      `DELETE FROM tracker_relationship_index WHERE workspace = $1 AND source_item_id = $2`,
      [workspace, sourceItemId],
    );
    await upsertRelationshipEdges(workspace, sourceItemId, edges, sourceUpdatedAt, db);
  } catch (err) {
    logger.main.warn('[trackerRelationshipIndexStore] rebuild failed for', sourceItemId, err);
  }
}

/** Drop all outgoing edges for an item (call when the item is deleted). */
export async function removeItemRelationships(
  workspace: string,
  sourceItemId: string,
  dbOverride?: RelationshipIndexDb,
): Promise<void> {
  try {
    const db = dbOverride ?? (getDatabase() as RelationshipIndexDb | null);
    if (!db) return;
    await db.query(
      `DELETE FROM tracker_relationship_index WHERE workspace = $1 AND source_item_id = $2`,
      [workspace, sourceItemId],
    );
  } catch (err) {
    logger.main.warn('[trackerRelationshipIndexStore] remove failed for', sourceItemId, err);
  }
}

function mapRow(r: any): RelationshipIndexRow {
  return {
    sourceItemId: r.source_item_id,
    sourceFieldId: r.source_field_id,
    relationshipTypeKey: r.relationship_type_key ?? null,
    targetItemId: r.target_item_id,
    targetTrackerType: r.target_tracker_type ?? null,
    metadata: parseMeta(r.metadata),
  };
}

/** Outgoing edges from an item ("what does X link to?"). */
export async function getOutgoingRelationships(
  workspace: string,
  sourceItemId: string,
  dbOverride?: RelationshipIndexDb,
): Promise<RelationshipIndexRow[]> {
  try {
    const db = dbOverride ?? (getDatabase() as RelationshipIndexDb | null);
    if (!db) return [];
    const result = await db.query(
      `SELECT * FROM tracker_relationship_index
       WHERE workspace = $1 AND source_item_id = $2
       ORDER BY source_field_id, target_item_id`,
      [workspace, sourceItemId],
    );
    return rowsOf(result).map(mapRow);
  } catch (err) {
    logger.main.warn('[trackerRelationshipIndexStore] getOutgoing failed for', sourceItemId, err);
    return [];
  }
}

/**
 * Derive a single item's relationship edges from its fields bag + the schema
 * field definitions for its type, then replace its index rows. The fields bag is
 * the parsed `data` column; relationship values may sit top-level (local) or
 * nested under `data.customFields` (synced), so flatten first (NIM-1305).
 */
export async function reindexItemRelationships(
  workspace: string,
  sourceItemId: string,
  fields: Record<string, unknown> | undefined,
  fieldDefs: FieldDefinition[],
  sourceUpdatedAt: string | null,
  dbOverride?: RelationshipIndexDb,
): Promise<void> {
  const edges = deriveRelationshipEdges(sourceItemId, flattenDataForRead(fields), fieldDefs);
  await rebuildItemRelationships(workspace, sourceItemId, edges, sourceUpdatedAt, dbOverride);
}

/**
 * Reindex multiple source items after one bounded IPC request. Items are grouped
 * by workspace so each group pays one delete instead of one delete per item;
 * edge upserts remain per edge because both supported backends share that safe
 * parameter shape.
 */
export async function reindexItemsRelationships(
  items: RelationshipReindexItem[],
  dbOverride?: RelationshipIndexDb,
): Promise<void> {
  try {
    const db = dbOverride ?? (getDatabase() as RelationshipIndexDb | null);
    if (!db || items.length === 0) return;

    const byWorkspace = new Map<string, RelationshipReindexItem[]>();
    for (const item of items) {
      const group = byWorkspace.get(item.workspace) ?? [];
      group.push(item);
      byWorkspace.set(item.workspace, group);
    }

    for (const [workspace, group] of byWorkspace) {
      const placeholders = group.map((_, index) => `$${index + 2}`).join(', ');
      await db.query(
        `DELETE FROM tracker_relationship_index
         WHERE workspace = $1 AND source_item_id IN (${placeholders})`,
        [workspace, ...group.map(item => item.sourceItemId)],
      );
      for (const item of group) {
        const edges = deriveRelationshipEdges(
          item.sourceItemId,
          flattenDataForRead(item.fields),
          item.fieldDefs,
        );
        await upsertRelationshipEdges(
          workspace,
          item.sourceItemId,
          edges,
          item.sourceUpdatedAt,
          db,
        );
      }
    }
  } catch (err) {
    logger.main.warn('[trackerRelationshipIndexStore] batch rebuild failed', err);
  }
}

/**
 * Full rebuild of a workspace's relationship index from `tracker_items` JSON.
 * Local projection is rebuildable at any time; call on tracker init so existing
 * items are indexed without a re-save. `fieldDefsFor(type)` resolves a type's
 * schema fields (e.g. `globalRegistry.get(type)?.fields ?? []`).
 */
export async function rebuildWorkspaceRelationshipIndex(
  workspace: string,
  fieldDefsFor: (type: string) => FieldDefinition[],
  dbOverride?: RelationshipIndexDb,
): Promise<number> {
  try {
    const db = dbOverride ?? (getDatabase() as RelationshipIndexDb | null);
    if (!db) return 0;
    const result = await db.query(
      `SELECT id, type, data, updated FROM tracker_items WHERE workspace = $1`,
      [workspace],
    );
    const rows = rowsOf(result);
    // Clear the whole workspace projection first so deleted items drop out.
    await db.query(`DELETE FROM tracker_relationship_index WHERE workspace = $1`, [workspace]);
    let indexed = 0;
    for (const row of rows) {
      const data = parseMeta(row.data);
      const defs = fieldDefsFor(row.type) ?? [];
      const edges = deriveRelationshipEdges(row.id, flattenDataForRead(data), defs);
      if (edges.length === 0) continue;
      const updatedAt = typeof row.updated === 'string' ? row.updated : null;
      // No per-item delete needed (workspace was just cleared); rebuild inserts.
      await rebuildItemRelationships(workspace, row.id, edges, updatedAt, db);
      indexed += edges.length;
    }
    return indexed;
  } catch (err) {
    logger.main.warn('[trackerRelationshipIndexStore] workspace rebuild failed for', workspace, err);
    return 0;
  }
}

/** Incoming edges pointing at an item — the backlinks / "Linked From" set. */
export async function getBacklinks(
  workspace: string,
  targetItemId: string,
  dbOverride?: RelationshipIndexDb,
): Promise<RelationshipIndexRow[]> {
  try {
    const db = dbOverride ?? (getDatabase() as RelationshipIndexDb | null);
    if (!db) return [];
    const result = await db.query(
      `SELECT * FROM tracker_relationship_index
       WHERE workspace = $1 AND target_item_id = $2
       ORDER BY source_item_id`,
      [workspace, targetItemId],
    );
    return rowsOf(result).map(mapRow);
  } catch (err) {
    logger.main.warn('[trackerRelationshipIndexStore] getBacklinks failed for', targetItemId, err);
    return [];
  }
}
