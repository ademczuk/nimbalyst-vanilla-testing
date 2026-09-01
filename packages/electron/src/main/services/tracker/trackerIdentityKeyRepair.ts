/**
 * Clear the legacy second copy of a tracker item's identity keys out of `data`.
 *
 * `issueNumber` / `issueKey` / `typeTags` live in the `issue_number`,
 * `issue_key` and `type_tags` columns. Before the write paths were fixed they
 * were also written into the `data` JSONB, by different, non-atomic rules -- the
 * columns COALESCE, the blob is replaced wholesale from the server payload -- so
 * the two drifted. On the workspace where this was found, 245 rows carried a
 * blob key naming a different item than their own row did.
 *
 * The write paths no longer produce that copy and no converter reads it, so this
 * pass only clears what is already on disk. It is hygiene, not a correctness
 * fix: leaving the stale copy in place means every future known-set has to
 * remember to exclude it, and the one that forgets leaks a wrong key.
 *
 * ## Why this cannot cause sync churn
 *
 * The wire payload is built by `pgliteRowToPayload`, which already carves these
 * keys out of `fields`. Stripping them from `data` therefore produces a byte
 * identical payload. `sync_status`, `sync_id` and `updated` are untouched, and
 * `tracker_items` has no triggers; the generated columns project `title`,
 * `status` and `kanbanSortOrder`, none of which this removes.
 *
 * ## The guard
 *
 * A row is only rewritten when its `issue_key` and `issue_number` columns are
 * both populated -- that is what makes the blob copy provably redundant rather
 * than the last surviving record of the key.
 *
 * This matters. The `issue_number` collision branch in `TrackerPGLiteStore`
 * lands an incoming row with NULL number and key, and there is no renumber path
 * anywhere in the app to give it one back. For those rows the blob copy is the
 * only place the server's allocation still exists, so stripping it would destroy
 * the evidence needed to reconcile them. They are left exactly as they are.
 */
import type { DatabaseEngine } from '../../database/PGLiteDatabaseWorker';
import { jsonKeyExpr } from '../../database/jsonKeyExpr';
import { logger } from '../../utils/logger';
import { COLUMN_ONLY_IDENTITY_KEYS } from './trackerRowCustomFields';

/** The narrow slice of `AppDatabase` this pass needs, so it is testable without one. */
export interface TrackerIdentityKeyRepairDb {
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }>;
  getEngine?(): DatabaseEngine;
}

export interface TrackerIdentityKeyRepairResult {
  /** Rows whose `data` blob was rewritten. */
  repaired: number;
  /**
   * Rows left alone because their `issue_key` / `issue_number` columns are
   * NULL, so the blob copy is the only key they have left. These are the
   * collision-stranded rows.
   */
  strandedSkipped: number;
}

const NOTHING_DONE: TrackerIdentityKeyRepairResult = { repaired: 0, strandedSkipped: 0 };

/**
 * Strip the column-only identity keys from every row in one workspace whose
 * columns already carry them. Idempotent: a second run repairs nothing.
 */
export async function repairTrackerIdentityKeys(
  db: TrackerIdentityKeyRepairDb,
  workspacePath: string,
): Promise<TrackerIdentityKeyRepairResult> {
  // No JSON-removal dialect satisfies both backends, and the wrong one is a
  // thrown query rather than a wrong answer. This pass is hygiene on rows no
  // reader consults, so an unknown engine skips it rather than guessing.
  const engine = typeof db.getEngine === 'function' ? db.getEngine() : null;
  if (engine !== 'sqlite' && engine !== 'pglite') return NOTHING_DONE;

  const hasBlobCopy = COLUMN_ONLY_IDENTITY_KEYS
    .map((key) => `${jsonKeyExpr(engine, 'data', key)} IS NOT NULL`)
    .join(' OR ');
  const keyed = 'issue_key IS NOT NULL AND issue_number IS NOT NULL';

  const counts = await db.query<{ repairable: number | string; stranded: number | string }>(
    `SELECT
       COUNT(*) FILTER (WHERE ${keyed})     AS repairable,
       COUNT(*) FILTER (WHERE NOT (${keyed})) AS stranded
     FROM tracker_items
     WHERE workspace = $1 AND (${hasBlobCopy})`,
    [workspacePath],
  );
  const repaired = Number(counts.rows[0]?.repairable ?? 0);
  const strandedSkipped = Number(counts.rows[0]?.stranded ?? 0);

  if (repaired > 0) {
    const stripped = engine === 'sqlite'
      ? `json_remove(data, ${COLUMN_ONLY_IDENTITY_KEYS.map((k) => `'$.${k}'`).join(', ')})`
      : COLUMN_ONLY_IDENTITY_KEYS.reduce((expr, k) => `${expr} - '${k}'`, 'data');

    await db.query(
      `UPDATE tracker_items
          SET data = ${stripped}
        WHERE workspace = $1 AND ${keyed} AND (${hasBlobCopy})`,
      [workspacePath],
    );
  }

  if (repaired > 0 || strandedSkipped > 0) {
    logger.main.info(
      '[TrackerIdentityKeyRepair] cleared legacy identity keys from data blob --',
      'repaired:', repaired,
      'left stranded (no issue key in columns):', strandedSkipped,
    );
  }

  return { repaired, strandedSkipped };
}
