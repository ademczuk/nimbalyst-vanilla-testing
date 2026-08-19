import {
  isTrackerNavigationEntry,
  type TrackerNavigationEntry,
} from '@nimbalyst/runtime/sync';
import { getDatabase } from '../../database/initialize';
import { logger } from '../../utils/logger';
import { listTeamTrackerTypes, type TypeDefDb } from './trackerTypeDefStore';

interface NavigationRow {
  entry_id: string;
  payload: string | TrackerNavigationEntry;
  sync_id?: number | string | null;
  sync_status?: string | null;
  deleted_at?: string | null;
}

/**
 * A row's entry, with a legacy folder's missing `ownership` resolved: a row that
 * ever synced came from (or went to) the team room, so it is the team's;
 * anything else is this machine's. Doing it here means no migration pass and no
 * caller ever sees an entry without an owner.
 */
function parsePayload(
  raw: string | TrackerNavigationEntry,
  syncId?: number | string | null,
): TrackerNavigationEntry | null {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!isTrackerNavigationEntry(parsed)) return null;
    if (parsed.kind !== 'folder' || parsed.ownership) return parsed;
    return { ...parsed, ownership: syncId != null ? 'team' : 'personal' };
  } catch {
    return null;
  }
}

/**
 * Whether an entry is this machine's business only. A folder says so itself; a
 * placement's owner is its tracker's `sharing`, so sharing a tracker moves its
 * placement without anyone having to remember to restamp it.
 */
async function isPersonalEntry(
  workspace: string,
  entry: TrackerNavigationEntry,
  db: TypeDefDb,
  teamTypes?: Set<string>,
): Promise<boolean> {
  if (entry.kind === 'folder') return entry.ownership !== 'team';
  const types = teamTypes ?? await listTeamTrackerTypes(workspace, db);
  return !types.has(entry.trackerType);
}

export async function listTrackerNavigationEntries(
  workspace: string,
  dbOverride?: TypeDefDb,
): Promise<TrackerNavigationEntry[]> {
  if (!workspace) return [];
  try {
    const db = dbOverride ?? getDatabase();
    if (!db) return [];
    const result = await db.query(
      `SELECT entry_id, payload, sync_id FROM tracker_type_navigation
       WHERE workspace = $1 AND deleted_at IS NULL`,
      [workspace],
    ) as { rows?: NavigationRow[] } | undefined;
    return (result?.rows ?? []).flatMap((row) => {
      const entry = parsePayload(row.payload, row.sync_id);
      return entry ? [entry] : [];
    });
  } catch (err) {
    logger.main.warn('[trackerNavigationStore] list failed:', err);
    return [];
  }
}

export async function upsertTrackerNavigationEntry(
  workspace: string,
  entry: TrackerNavigationEntry,
  dbOverride?: TypeDefDb,
): Promise<void> {
  if (!workspace || !isTrackerNavigationEntry(entry)) {
    throw new Error('Invalid tracker navigation entry');
  }
  const db = dbOverride ?? getDatabase();
  if (!db) throw new Error('Database not initialized');
  const existing = await db.query(
    `SELECT sync_id, sync_status FROM tracker_type_navigation
     WHERE workspace = $1 AND entry_id = $2`,
    [workspace, entry.entryId],
  ) as { rows?: NavigationRow[] } | undefined;
  const existingRow = existing?.rows?.[0];
  // A personal row parks in its own terminal status rather than sitting in the
  // outbox forever; sharing its tracker rewrites it to 'pending' (see
  // TrackerNavigationService), which is what puts it back in the push lane. A
  // personal row that an older build already synced first emits a tombstone so
  // the team room forgets the leaked placement before it parks as personal.
  const personal = await isPersonalEntry(workspace, entry, db);
  const status = personal
    ? existingRow?.sync_id != null && existingRow.sync_status !== 'personal'
      ? 'personal-cleanup'
      : 'personal'
    : 'pending';
  await db.query(
    `INSERT INTO tracker_type_navigation
       (workspace, entry_id, kind, payload, updated, deleted_at, sync_status)
     VALUES ($1, $2, $3, $4, NOW(), NULL, $5)
     ON CONFLICT (workspace, entry_id) DO UPDATE SET
       kind = EXCLUDED.kind,
       payload = EXCLUDED.payload,
       updated = NOW(),
       deleted_at = NULL,
       sync_status = EXCLUDED.sync_status`,
    [workspace, entry.entryId, entry.kind, JSON.stringify(entry), status],
  );
}

export async function removeTrackerNavigationEntry(
  workspace: string,
  entryId: string,
  dbOverride?: TypeDefDb,
): Promise<void> {
  const db = dbOverride ?? getDatabase();
  if (!db) throw new Error('Database not initialized');
  const existing = await db.query(
    `SELECT payload, sync_id, sync_status FROM tracker_type_navigation
     WHERE workspace = $1 AND entry_id = $2 AND deleted_at IS NULL`,
    [workspace, entryId],
  ) as { rows?: NavigationRow[] } | undefined;
  const row = existing?.rows?.[0];
  const entry = row ? parsePayload(row.payload, row.sync_id) : null;
  // A tombstone for a row peers never saw has nothing to say to them.
  const personal = entry && await isPersonalEntry(workspace, entry, db);
  const status = personal
    ? row?.sync_id != null && row.sync_status !== 'personal'
      ? 'personal-cleanup'
      : 'personal'
    : 'pending';
  await db.query(
    `UPDATE tracker_type_navigation
     SET deleted_at = NOW(), updated = NOW(), sync_status = $3
     WHERE workspace = $1 AND entry_id = $2 AND deleted_at IS NULL`,
    [workspace, entryId, status],
  );
}

export interface UnsyncedTrackerNavigationEntry {
  entryId: string;
  payload: string | null;
  deleted: boolean;
}

/**
 * The push-side outbox, and the one choke point where ownership is enforced —
 * mirroring the schema-def gate in {@link listUnsyncedTrackerSchemaDefs}. A
 * No personal payload leaves this machine. A locally-originated placement that
 * an older build already synced emits only its deterministic entry id as a
 * one-time tombstone; a remote-origin row whose schema is temporarily unknown
 * is quarantined rather than mistaken for such a leak.
 *
 * Filtered in JS after the fetch rather than in SQL: `payload` is JSON TEXT and
 * sub-extraction diverges between PGLite and SQLite (see DATABASE.md), and this
 * table holds a handful of rows per workspace.
 */
export async function listUnsyncedTrackerNavigationEntries(
  workspace: string,
  dbOverride?: TypeDefDb,
): Promise<UnsyncedTrackerNavigationEntry[]> {
  try {
    const db = dbOverride ?? getDatabase();
    if (!db) return [];
    const result = await db.query(
      `SELECT entry_id, payload, deleted_at, sync_id, sync_status
       FROM tracker_type_navigation WHERE workspace = $1`,
      [workspace],
    ) as { rows?: Array<NavigationRow & { deleted_at: string | null }> } | undefined;
    const rows = result?.rows ?? [];
    if (rows.length === 0) return [];
    const teamTypes = await listTeamTrackerTypes(workspace, db);
    const out: UnsyncedTrackerNavigationEntry[] = [];
    for (const row of rows) {
      const entry = parsePayload(row.payload, row.sync_id);
      if (entry && await isPersonalEntry(workspace, entry, db, teamTypes)) {
        // Schema bootstrap deliberately degrades on timeout. A placement learned
        // during the following navigation bootstrap is remote provenance, not
        // proof that this client leaked a default-personal type. Leave it parked
        // until a schema or a local edit establishes ownership.
        if (row.sync_status === 'remote') continue;
        // Builds before folder ownership pushed every placement, including the
        // deterministic `type:<personal-name>` row. Retract that already-synced
        // server state once, then keep the local row in the terminal `personal`
        // status. Remote tombstone application below preserves the local copy.
        if (row.sync_id != null && row.sync_status !== 'personal') {
          out.push({ entryId: row.entry_id, payload: null, deleted: true });
        }
        continue;
      }
      if (row.sync_status !== 'local' && row.sync_status !== 'pending') continue;
      out.push({
        entryId: row.entry_id,
        payload: row.deleted_at ? null : (typeof row.payload === 'string' ? row.payload : JSON.stringify(row.payload)),
        deleted: row.deleted_at != null,
      });
    }
    return out;
  } catch (err) {
    logger.main.warn('[trackerNavigationStore] listUnsynced failed:', err);
    return [];
  }
}

export async function getMaxTrackerNavigationSyncId(
  workspace: string,
  dbOverride?: TypeDefDb,
): Promise<number> {
  try {
    const db = dbOverride ?? getDatabase();
    if (!db) return 0;
    const result = await db.query(
      `SELECT MAX(sync_id) AS max_sync_id FROM tracker_type_navigation
       WHERE workspace = $1 AND sync_id IS NOT NULL`,
      [workspace],
    ) as { rows?: Array<{ max_sync_id: number | string | null }> } | undefined;
    const raw = result?.rows?.[0]?.max_sync_id;
    const value = typeof raw === 'string' ? Number(raw) : raw;
    return Number.isFinite(value) ? Number(value) : 0;
  } catch (err) {
    logger.main.warn('[trackerNavigationStore] getMaxSyncId failed:', err);
    return 0;
  }
}

export type ApplyRemoteNavigationResult =
  | { applied: true; deleted: boolean; entry: TrackerNavigationEntry | null }
  | { applied: false; reason: 'stale' | 'invalid' | 'error' };

export async function applyRemoteTrackerNavigationEntry(
  workspace: string,
  def: { entryId: string; payload: string | null; syncId: number },
  dbOverride?: TypeDefDb,
): Promise<ApplyRemoteNavigationResult> {
  if (!workspace || !def.entryId || !Number.isFinite(def.syncId)) {
    return { applied: false, reason: 'invalid' };
  }
  const parsed = def.payload === null ? null : parsePayload(def.payload, def.syncId);
  if (def.payload !== null && (!parsed || parsed.entryId !== def.entryId)) {
    return { applied: false, reason: 'invalid' };
  }
  // It came out of the team room, so it is the team's whatever it claims.
  const entry = parsed?.kind === 'folder' ? { ...parsed, ownership: 'team' as const } : parsed;
  try {
    const db = dbOverride ?? getDatabase();
    if (!db) return { applied: false, reason: 'error' };
    const existing = await db.query(
      `SELECT payload, sync_id, sync_status, deleted_at
       FROM tracker_type_navigation WHERE workspace = $1 AND entry_id = $2`,
      [workspace, def.entryId],
    ) as { rows?: NavigationRow[] } | undefined;
    const existingRow = existing?.rows?.[0];
    const rawCurrent = existingRow?.sync_id;
    const current = typeof rawCurrent === 'string' ? Number(rawCurrent) : rawCurrent;
    if (current != null && current >= def.syncId) return { applied: false, reason: 'stale' };

    // The local row wins when it is this machine's. Folder ids are UUIDs so a
    // folder can't collide, but a placement's entry id is deterministic
    // (`type:<trackerType>`): a tracker that is personal here still has a
    // team-side placement on the server, and bootstrap would otherwise replay it
    // over the local one.
    const localEntry = existingRow ? parsePayload(existingRow.payload, existingRow.sync_id) : null;
    if (existingRow?.sync_status !== 'remote'
      && localEntry
      && await isPersonalEntry(workspace, localEntry, db)) {
      if (def.payload === null) {
        await db.query(
          `UPDATE tracker_type_navigation
           SET sync_id = $3, sync_status = 'personal', updated = NOW()
           WHERE workspace = $1 AND entry_id = $2`,
          [workspace, def.entryId, def.syncId],
        );
        const locallyDeleted = existingRow?.deleted_at != null;
        return {
          applied: true,
          deleted: locallyDeleted,
          entry: locallyDeleted ? null : localEntry,
        };
      }
      logger.main.info(
        '[trackerNavigationStore] ignoring remote navigation entry',
        def.entryId, 'for locally-personal row in', workspace,
      );
      return { applied: false, reason: 'stale' };
    }

    const kind = entry?.kind ?? (def.entryId.startsWith('folder:') ? 'folder' : 'type-placement');
    const storedPayload = entry ? JSON.stringify(entry) : '{}';
    // A brand-new inbound row is quarantined as remote provenance. This keeps a
    // schema-bootstrap timeout from turning it into an outbound privacy-cleanup
    // tombstone. A row already in our outbox is receiving its server ack and
    // therefore advances to the ordinary synced status.
    const inboundStatus = existingRow == null || existingRow.sync_status === 'remote'
      ? 'remote'
      : 'synced';
    await db.query(
      `INSERT INTO tracker_type_navigation
         (workspace, entry_id, kind, payload, updated, deleted_at, sync_id, sync_status)
       VALUES ($1, $2, $3, $4, NOW(), ${def.payload === null ? 'NOW()' : 'NULL'}, $5, $6)
       ON CONFLICT (workspace, entry_id) DO UPDATE SET
         kind = EXCLUDED.kind,
         payload = EXCLUDED.payload,
         updated = NOW(),
         deleted_at = EXCLUDED.deleted_at,
         sync_id = EXCLUDED.sync_id,
         sync_status = EXCLUDED.sync_status`,
      [workspace, def.entryId, kind, storedPayload, def.syncId, inboundStatus],
    );
    return { applied: true, deleted: def.payload === null, entry };
  } catch (err) {
    logger.main.warn('[trackerNavigationStore] applyRemote failed:', err);
    return { applied: false, reason: 'error' };
  }
}
