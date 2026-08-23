/**
 * ReadReceiptsStore - Database CRUD for the unread-indicator read receipts.
 *
 * Backs the `read_receipts` table (SQLite migration 0016 / PGLite worker.js).
 * Pattern follows PullRequestsStore / WorktreeStore — a factory that takes the
 * PGLite/SQLite handle and returns a typed object with CRUD methods.
 *
 * A read receipt records that a user has viewed a given entity (a tracker item
 * or a shared doc) up to a certain version at a certain time. The "unread"
 * decision itself is pure and lives in
 * `packages/runtime/src/readReceipts/readReceipts.ts`.
 *
 * Personal, not team: receipts are personal per-user state ABOUT team objects.
 * They are never written to a tracker/document row and they sync only on the
 * PERSONAL channel (see jwt-scopes.md). This store is the LOCAL persistence.
 *
 * Dual-backend caveat: BIGINT columns come back as numbers on SQLite but as
 * strings on PGLite, so every numeric read is coerced with `Number()`.
 * `last_seen_version` is nullable (trackers have no numeric version in the
 * renderer, so they watermark on `last_viewed_at` alone).
 */

import log from 'electron-log/main';
import type { ReadReceiptEntityKind } from '@nimbalyst/runtime/readReceipts/readReceipts';

const logger = log.scope('ReadReceiptsStore');

type PGliteLike = {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

type EnsureReadyFn = () => Promise<void>;

/** A read-receipt row as returned to callers (camelCase, numeric epoch ms). */
export interface ReadReceiptRow {
  userEmail: string;
  entityKind: ReadReceiptEntityKind;
  entityId: string;
  scope: string;
  lastViewedAt: number;
  lastSeenVersion: number | null;
  updatedAt: number;
}

/** The mutable part of a receipt supplied when marking an entity viewed. */
export interface MarkViewedInput {
  userEmail: string;
  entityKind: ReadReceiptEntityKind;
  entityId: string;
  scope: string;
  lastViewedAt: number;
  lastSeenVersion: number | null;
  /** Receipt-row write time (epoch ms). Defaults to lastViewedAt when omitted. */
  updatedAt?: number;
}

interface ReadReceiptDbRow {
  user_email: string;
  entity_kind: string;
  entity_id: string;
  scope: string;
  last_viewed_at: number | string;
  last_seen_version: number | string | null;
  updated_at: number | string;
}

function rowToReceipt(row: ReadReceiptDbRow): ReadReceiptRow {
  return {
    userEmail: row.user_email,
    entityKind: row.entity_kind as ReadReceiptEntityKind,
    entityId: row.entity_id,
    scope: row.scope,
    lastViewedAt: Number(row.last_viewed_at),
    lastSeenVersion: row.last_seen_version == null ? null : Number(row.last_seen_version),
    updatedAt: Number(row.updated_at),
  };
}

export function createReadReceiptsStore(db: PGliteLike, ensureDbReady?: EnsureReadyFn) {
  const ensureReady = async (): Promise<void> => {
    if (ensureDbReady) {
      await ensureDbReady();
    }
  };

  async function getOne(
    userEmail: string,
    entityKind: ReadReceiptEntityKind,
    entityId: string,
    scope: string,
  ): Promise<ReadReceiptRow | null> {
    const { rows } = await db.query<ReadReceiptDbRow>(
      `SELECT * FROM read_receipts
       WHERE user_email = $1 AND entity_kind = $2 AND entity_id = $3 AND scope = $4`,
      [userEmail, entityKind, entityId, scope],
    );
    return rows.length > 0 ? rowToReceipt(rows[0]) : null;
  }

  return {
    /**
     * All receipts for one (user, entityKind, scope) — the list the renderer
     * needs to compute unread state for every visible tracker/doc at once.
     */
    async getForScope(
      userEmail: string,
      entityKind: ReadReceiptEntityKind,
      scope: string,
    ): Promise<ReadReceiptRow[]> {
      await ensureReady();
      const { rows } = await db.query<ReadReceiptDbRow>(
        `SELECT * FROM read_receipts
         WHERE user_email = $1 AND entity_kind = $2 AND scope = $3`,
        [userEmail, entityKind, scope],
      );
      return rows.map(rowToReceipt);
    },

    getOne,

    /**
     * Mark an entity viewed — ADVANCE-ONLY upsert. Merges against any existing
     * receipt so a receipt can only move forward (viewing on device A must
     * never be undone by a stale write). Returns the resulting row, or `null`
     * when the write was a no-op (incoming did not advance the existing
     * receipt), so callers can skip a pointless sync push.
     */
    async markViewed(input: MarkViewedInput): Promise<ReadReceiptRow | null> {
      await ensureReady();

      const updatedAt = input.updatedAt ?? input.lastViewedAt;

      // One round trip, not two. This used to SELECT the existing receipt,
      // merge it in JS, then upsert — 17,711 reads in a five-minute window
      // (~59/s) on a FIFO single-lane DB worker, every one of them paired with
      // a write. The merge is `mergeReceipt` (max on both watermarks, null
      // meaning "no version") and the skip is `receiptAdvances`; both are
      // expressible in the conflict clause, so the SELECT buys nothing.
      //
      // The DO UPDATE ... WHERE is the advance-only guarantee: a receipt can
      // only move forward, so viewing on one device is never undone by a stale
      // write arriving from another. When it does not advance, no row is
      // updated and RETURNING yields nothing — which is exactly the `null`
      // ("no-op, skip the sync push") the previous JS guard returned.
      const { rows } = await db.query<ReadReceiptDbRow>(
        `INSERT INTO read_receipts
           (user_email, entity_kind, entity_id, scope, last_viewed_at, last_seen_version, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (user_email, entity_kind, entity_id, scope) DO UPDATE SET
           last_viewed_at    = GREATEST(read_receipts.last_viewed_at, EXCLUDED.last_viewed_at),
           last_seen_version = CASE
             WHEN read_receipts.last_seen_version IS NULL THEN EXCLUDED.last_seen_version
             WHEN EXCLUDED.last_seen_version IS NULL THEN read_receipts.last_seen_version
             ELSE GREATEST(read_receipts.last_seen_version, EXCLUDED.last_seen_version)
           END,
           updated_at        = EXCLUDED.updated_at
         WHERE EXCLUDED.last_viewed_at > read_receipts.last_viewed_at
            OR (read_receipts.last_seen_version IS NULL AND EXCLUDED.last_seen_version IS NOT NULL)
            OR (read_receipts.last_seen_version IS NOT NULL
                AND EXCLUDED.last_seen_version IS NOT NULL
                AND EXCLUDED.last_seen_version > read_receipts.last_seen_version)
         RETURNING *`,
        [
          input.userEmail,
          input.entityKind,
          input.entityId,
          input.scope,
          input.lastViewedAt,
          input.lastSeenVersion,
          updatedAt,
        ],
      );

      if (rows.length === 0) {
        return null;
      }

      const merged = rowToReceipt(rows[0]);

      logger.debug('markViewed', {
        entityKind: input.entityKind,
        entityId: input.entityId,
        scope: input.scope,
        lastSeenVersion: merged.lastSeenVersion,
      });

      return merged;
    },
  };
}

export type ReadReceiptsStore = ReturnType<typeof createReadReceiptsStore>;
