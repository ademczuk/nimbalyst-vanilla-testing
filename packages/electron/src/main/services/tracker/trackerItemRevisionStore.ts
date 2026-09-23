/**
 * Reads over `tracker_item_revisions` (knowledge-scopes contract 4.2).
 *
 * Revision identity is a UUID (`revisionId`), assigned wherever the write
 * happened. The only sequential number, `serverRevision`, is assigned by the
 * room on sync and is NULL until then. This mirrors how tracker identity
 * already works: item ids are ULIDs and issue keys are minted by the room on
 * publication. A locally assigned sequence would mean "revision 3" names a
 * different write on every machine.
 *
 * Ordinary writes are not here: the log is appended by database triggers, so
 * every writer of `tracker_items` is covered, including the ones that never go
 * through `TrackerPGLiteStore`. See
 * `database/sqlite/schemas/0047_tracker_item_revision_scope.sql`. The triggers only
 * record knowledge types; `pinItemRevision` is the one write here, and it is
 * how a citation pins an item of any other type.
 *
 * The contract's rule that shapes this module: **a missing revision is an
 * error, never the latest.** A citation that pins revision 3 and silently
 * renders revision 7 is worse than one that fails, because nothing about the
 * result says the evidence moved.
 */

import crypto from 'crypto';
import type { AppDatabase } from '../../database/PGLiteDatabaseWorker';
import type { TrackerIdentity } from '@nimbalyst/tracker-core';

export interface TrackerItemRevision {
  revisionId: string;
  itemId: string;
  /** The revision this one superseded; null for an item's first revision. */
  parentRevisionId: string | null;
  /**
   * Sequential display number owned by the room. `null` means this revision
   * has never been to the server, not "revision 0".
   */
  serverRevision: number | null;
  workspace: string;
  /** Full field bag as of this revision, not a delta. */
  data: Record<string, unknown>;
  actor: TrackerIdentity | null;
  /**
   * `null` means the row alone could not decide, not "draft": the last branch
   * of `getItemPublicationState` reads the tracker schema's `draftByDefault`,
   * which SQL cannot. Resolve a null against the schema before displaying it.
   */
  published: boolean | null;
  syncStatus: string | null;
  syncId: number | null;
  /** Non-null when this revision records deletion of the item. */
  deletedAt: number | null;
  recordedAt: number;
}

export class TrackerRevisionNotFoundError extends Error {
  constructor(readonly itemId: string, readonly revisionRef: string | number) {
    super(`Tracker item '${itemId}' has no revision ${revisionRef}`);
    this.name = 'TrackerRevisionNotFoundError';
  }
}

interface RevisionRow {
  revision_id: string;
  item_id: string;
  parent_revision_id: string | null;
  server_revision: number | null;
  workspace: string;
  data: unknown;
  actor: unknown;
  published: unknown;
  sync_status: string | null;
  sync_id: number | null;
  deleted_at: unknown;
  recorded_at: unknown;
}

const SELECT_COLUMNS = `
  revision_id, item_id, parent_revision_id, server_revision, workspace, data,
  actor, published, sync_status, sync_id, deleted_at, recorded_at
`;

/**
 * The tip of an item's chain: the revision no other revision claims as parent.
 *
 * Deliberately not `ORDER BY recorded_at DESC`. Two writes inside one
 * millisecond share a timestamp, and the tie-break would then be a random
 * UUID, which can invert real history. The chain is the only thing that knows
 * the true order.
 */
const TIP_PREDICATE = `
  revision_id NOT IN (
    SELECT p.parent_revision_id FROM tracker_item_revisions p
    WHERE p.item_id = $1 AND p.workspace = $2 AND p.parent_revision_id IS NOT NULL
  )`;

/**
 * PGLite hands back a parsed object for a JSONB column; SQLite hands back the
 * JSON text. Both backends are live, so every read normalizes.
 */
function parseJsonColumn(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

/** SQLite stores 0/1 and PGLite a real boolean; NULL stays NULL in both. */
function parsePublished(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value === '1' || value === 'true' || value === 't';
  return null;
}

function parseTimestamp(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
}

function toRevision(row: RevisionRow): TrackerItemRevision {
  return {
    revisionId: row.revision_id,
    itemId: row.item_id,
    parentRevisionId: row.parent_revision_id,
    serverRevision: row.server_revision,
    workspace: row.workspace,
    data: parseJsonColumn(row.data) ?? {},
    actor: parseJsonColumn(row.actor) as TrackerIdentity | null,
    published: parsePublished(row.published),
    syncStatus: row.sync_status,
    syncId: row.sync_id,
    deletedAt: row.deleted_at === null || row.deleted_at === undefined
      ? null
      : parseTimestamp(row.deleted_at),
    recordedAt: parseTimestamp(row.recorded_at),
  };
}

/**
 * One exact revision by its UUID. Throws `TrackerRevisionNotFoundError` when it
 * does not exist — deliberately, see the module header.
 */
export async function getItemRevision(
  db: AppDatabase,
  workspacePath: string,
  itemId: string,
  revisionId: string,
): Promise<TrackerItemRevision> {
  const result = await db.query<RevisionRow>(
    `SELECT ${SELECT_COLUMNS} FROM tracker_item_revisions
     WHERE item_id = $1 AND workspace = $2 AND revision_id = $3`,
    [itemId, workspacePath, revisionId],
  );
  const row = result.rows[0];
  if (!row) throw new TrackerRevisionNotFoundError(itemId, revisionId);
  return toRevision(row);
}

/**
 * One exact revision by the room-assigned number, which is what a published
 * citation and a public bundle carry. Unsynced revisions have no number and
 * are unreachable here by design.
 */
export async function getItemRevisionByServerNumber(
  db: AppDatabase,
  workspacePath: string,
  itemId: string,
  serverRevision: number,
): Promise<TrackerItemRevision> {
  const result = await db.query<RevisionRow>(
    `SELECT ${SELECT_COLUMNS} FROM tracker_item_revisions
     WHERE item_id = $1 AND workspace = $2 AND server_revision = $3`,
    [itemId, workspacePath, serverRevision],
  );
  const row = result.rows[0];
  if (!row) throw new TrackerRevisionNotFoundError(itemId, serverRevision);
  return toRevision(row);
}

/** The newest revision, or null for an item with no recorded history. */
export async function getLatestItemRevision(
  db: AppDatabase,
  workspacePath: string,
  itemId: string,
): Promise<TrackerItemRevision | null> {
  const result = await db.query<RevisionRow>(
    `SELECT ${SELECT_COLUMNS} FROM tracker_item_revisions
     WHERE item_id = $1 AND workspace = $2 AND ${TIP_PREDICATE}
     LIMIT 1`,
    [itemId, workspacePath],
  );
  const row = result.rows[0];
  return row ? toRevision(row) : null;
}

export class TrackerItemNotFoundError extends Error {
  constructor(readonly itemId: string) {
    super(`Tracker item '${itemId}' does not exist in this workspace`);
    this.name = 'TrackerItemNotFoundError';
  }
}

/**
 * The revision a citation should pin: the item's latest revision if it still
 * matches the live row, otherwise a snapshot of the live row appended to the
 * chain now.
 *
 * The triggers only record knowledge types, so for a bug or task this is the
 * moment its state becomes citable; for a knowledge type the tip normally
 * matches and nothing is written. The snapshot leaves `actor` and `published`
 * NULL: the pinner is not the item's author, and publication needs the schema.
 */
export async function pinItemRevision(
  db: AppDatabase,
  workspacePath: string,
  itemId: string,
): Promise<string> {
  const current = await db.query<{ revision_id: string | null; is_current: unknown }>(
    `SELECT r.revision_id,
       CASE WHEN r.revision_id IS NOT NULL
         AND r.data = t.data
         AND (r.deleted_at IS NULL) = (t.deleted_at IS NULL) THEN 1 ELSE 0 END AS is_current
     FROM tracker_items t
     LEFT JOIN tracker_item_revisions r ON r.item_id = t.id
       AND NOT EXISTS (
         SELECT 1 FROM tracker_item_revisions p
         WHERE p.item_id = t.id AND p.parent_revision_id = r.revision_id
       )
     WHERE t.id = $1 AND t.workspace = $2
     LIMIT 1`,
    [itemId, workspacePath],
  );
  const row = current.rows[0];
  if (!row) throw new TrackerItemNotFoundError(itemId);
  if (row.revision_id && Number(row.is_current) === 1) return row.revision_id;

  const revisionId = crypto.randomUUID();
  await db.query(
    `INSERT INTO tracker_item_revisions (
       revision_id, item_id, parent_revision_id, workspace, data, sync_status, sync_id, deleted_at
     )
     SELECT $1, t.id, $2, t.workspace, t.data, t.sync_status, t.sync_id, t.deleted_at
     FROM tracker_items t WHERE t.id = $3 AND t.workspace = $4`,
    [revisionId, row.revision_id, itemId, workspacePath],
  );
  return revisionId;
}

/**
 * History oldest-first, walked along `parent_revision_id` from the root.
 *
 * Bounded by `limit` because an item edited for a year has a long chain and no
 * caller wants all of it by accident. The recursion also bounds itself, so a
 * chain corrupted into a cycle cannot hang the query.
 */
export async function listItemRevisions(
  db: AppDatabase,
  workspacePath: string,
  itemId: string,
  options: { limit?: number } = {},
): Promise<TrackerItemRevision[]> {
  const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
  const result = await db.query<RevisionRow & { depth: number }>(
    `WITH RECURSIVE chain AS (
       SELECT ${SELECT_COLUMNS}, 1 AS depth FROM tracker_item_revisions
       WHERE item_id = $1 AND workspace = $2 AND parent_revision_id IS NULL
       UNION ALL
       SELECT ${SELECT_COLUMNS.split(',').map(c => `r.${c.trim()}`).join(', ')}, c.depth + 1
       FROM tracker_item_revisions r
       JOIN chain c ON r.parent_revision_id = c.revision_id
       WHERE r.item_id = $1 AND r.workspace = $2 AND c.depth < $3
     )
     SELECT ${SELECT_COLUMNS} FROM chain ORDER BY depth ASC LIMIT $3`,
    [itemId, workspacePath, limit],
  );
  return result.rows.map(toRevision);
}
