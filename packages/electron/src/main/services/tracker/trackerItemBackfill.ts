/**
 * The reconnect drain for tracker items an offline write left behind.
 *
 * Every item write path gates on `isTrackerSyncActive()`, which requires a
 * `connected` engine. When it is false the row is marked `sync_status='pending'`
 * and `syncTrackerItem` is never called, so -- unlike a write that started while
 * connected -- there is no `tracker_transactions` row for `replayPending` to
 * re-drive. This function is the only thing that ever pushes those rows.
 *
 * It used to be guarded by a process-lifetime `Set`, which meant it ran on the
 * first `connected` and never again: a mid-session disconnect left every edit
 * stranded until the next app launch, and a teammate touching the same row in
 * the meantime made `applyRemoteItem` stamp it `synced`, dropping the edit out
 * of the candidate set with no rejection and no log line (NIM-3657). The schema,
 * saved-view and navigation lanes all push at the end of every bootstrap; this
 * lane now does too. The only thing worth suppressing is a second pass while one
 * is still running.
 *
 * Dependencies arrive through a port so the decision is testable without the
 * engine registry, PGLite and Electron behind it.
 */

import type { TrackerItem } from '@nimbalyst/runtime';
import type { TrackerSharingPolicy } from '@nimbalyst/runtime/plugins/TrackerPlugin/models/TrackerDataModel';
import { decideBackfillAction } from '../TrackerPolicyService';

export interface TrackerItemBackfillPort {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
  upsertItem: (item: TrackerItem) => Promise<void>;
  deleteItem: (itemId: string) => Promise<void>;
  resolvePolicy: (workspacePath: string, type: string) => TrackerSharingPolicy;
  toItem: (row: any) => TrackerItem;
  log: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
}

export interface TrackerItemBackfillResult {
  queued: number;
  deleted: number;
  skipped: number;
  total: number;
  /** True when another pass was already running and this call did nothing. */
  skippedRun: boolean;
}

const EMPTY_RUN: TrackerItemBackfillResult = {
  queued: 0, deleted: 0, skipped: 0, total: 0, skippedRun: false,
};

/** Workspaces with a pass currently running. Not a "has ever run" record. */
const inFlight = new Set<string>();

export async function drainPendingTrackerItems(
  workspacePath: string,
  port: TrackerItemBackfillPort,
): Promise<TrackerItemBackfillResult> {
  if (inFlight.has(workspacePath)) return { ...EMPTY_RUN, skippedRun: true };
  inFlight.add(workspacePath);
  try {
    return await runDrain(workspacePath, port);
  } finally {
    inFlight.delete(workspacePath);
  }
}

async function runDrain(
  workspacePath: string,
  port: TrackerItemBackfillPort,
): Promise<TrackerItemBackfillResult> {
  // Candidates: never-synced items (`sync_id IS NULL`) plus items left
  // `sync_status='pending'` by an offline mutation -- including the `nim` CLI
  // writing directly to SQLite while the app was closed. Re-pushing an
  // already-synced item is idempotent: `applyRemoteItem` flips it back to
  // 'synced' on ack, so it falls out of this set on the next pass.
  const candidates = await port.query(
    `SELECT * FROM tracker_items
     WHERE workspace = $1
       AND (sync_id IS NULL OR sync_status = 'pending')
       AND deleted_at IS NULL
     ORDER BY created ASC`,
    [workspacePath],
  );

  const rows = candidates.rows ?? [];
  if (rows.length === 0) return { ...EMPTY_RUN };

  let queued = 0;
  let skipped = 0;
  let deleted = 0;
  for (const row of rows) {
    const policy = port.resolvePolicy(workspacePath, row.type as string);
    const item = port.toItem(row);
    // Per-item gate (NIM-876 / NIM-880): team drafts sync only once published.
    //   - published                  -> upsert
    //   - previously published (sync_id set) but now draft -> delete from the
    //       room (propagates an offline unshare; previously this re-uploaded the
    //       item or left a stale copy behind)
    //   - never published draft     -> skip (local-only, no leak)
    const previouslyShared = row.sync_id != null;
    const action = decideBackfillAction(policy, item as unknown as Record<string, any>, previouslyShared);
    if (action === 'skip') {
      skipped++;
      continue;
    }
    if (action === 'delete') {
      try {
        await port.deleteItem(row.id as string);
        // Reset the local row so it isn't re-processed (or re-deleted) on the
        // next reconnect.
        await port.query(
          `UPDATE tracker_items SET sync_status = 'local', sync_id = NULL WHERE id = $1`,
          [row.id],
        );
        deleted++;
      } catch (err) {
        port.log.warn('[TrackerItemBackfill] deleteItem failed for item', row.id, err);
      }
      continue;
    }
    try {
      await port.upsertItem(item);
      queued++;
    } catch (err) {
      // The row keeps `sync_status='pending'`, so the next connect retries it.
      port.log.warn('[TrackerItemBackfill] upsertItem failed for item', row.id, err);
    }
  }

  port.log.info(
    '[TrackerItemBackfill] drain complete for', workspacePath,
    'queued:', queued, 'deleted:', deleted, 'skipped-local-only:', skipped, 'total-candidates:', rows.length,
  );

  return { queued, deleted, skipped, total: rows.length, skippedRun: false };
}
