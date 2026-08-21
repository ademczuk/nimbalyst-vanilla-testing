/**
 * Is the database we are about to migrate plausibly the user's data?
 *
 * NIM-3632, from the #1347 postmortem. `PGLiteToSQLiteMigrator` copied 5, 14
 * and 204 rows out of PGLite stores that had already been silently emptied,
 * and reported a clean run. It could not have done otherwise: the count
 * verification compares the SQLite target against source counts measured at
 * start-of-run, so an empty source gives expected 0 / actual 0 and zero drift.
 * `integrity_check`, `foreign_key_check` and the spot-check all pass trivially
 * on an empty database. Every gate answered "did we copy the source
 * faithfully?" and none answered "was the source worth copying?"
 *
 * That is what turned a recoverable loss into a permanent one for three of the
 * six confirmed installs: their real data was still sitting in a
 * `pglite-db.backup-*` sibling, but once SQLite became the active backend
 * against the empty copy, nothing pointed back at it.
 *
 * So this function only accepts facts from OUTSIDE the source database. A
 * check that reads the thing it is validating cannot catch this class of bug.
 * It is pure and returns a plan, per `.claude/rules/destructive-data-paths.md`
 * -- the decision must be testable without a real WASM abort behind it.
 */

export interface MigrationSourceFacts {
  /** Size of the live `pglite-db/` directory. */
  liveDirBytes: number;
  /**
   * Size of the largest copy of the database sitting elsewhere on disk --
   * `db-backups/` or a `pglite-db.backup-*` sibling. `findRestorableBackups`
   * in `recoveryArtifacts.ts` already computes exactly this.
   */
  largestBackupBytes: number;
  /** Projects in electron-store `config.json`. Evidence the app was used. */
  configuredProjectCount: number;
  /** Sessions visible in the source database, or null if it could not be read. */
  sourceSessionCount: number | null;
}

export type MigrationSourceVerdict =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * A backup this much bigger than the live database is a different database,
 * not a slightly-stale copy of the same one. Backups legitimately drift by a
 * chunk of their size, so the bar is deliberately far above ordinary drift.
 */
const SUSPICIOUS_BACKUP_RATIO = 3;

/**
 * Below this, ratios stop meaning anything -- an empty PGLite store is already
 * a few MB of scaffolding, so a 1 MB / 4 MB comparison is noise rather than
 * signal. Both sides of the comparison have to clear it.
 */
const RATIO_FLOOR_BYTES = 32 * 1024 * 1024;

export function assessMigrationSource(facts: MigrationSourceFacts): MigrationSourceVerdict {
  const { liveDirBytes, largestBackupBytes, configuredProjectCount, sourceSessionCount } = facts;

  if (
    largestBackupBytes >= RATIO_FLOOR_BYTES &&
    largestBackupBytes > liveDirBytes * SUSPICIOUS_BACKUP_RATIO
  ) {
    return {
      ok: false,
      reason:
        `A database backup on disk (${humanBytes(largestBackupBytes)}) is far larger than the ` +
        `database about to be migrated (${humanBytes(liveDirBytes)}). The smaller one is ` +
        `probably not your data. Restore from the backup before migrating.`,
    };
  }

  // An unreadable count is not evidence of emptiness, so it never blocks here.
  // The size comparison above is the signal that does not depend on the source.
  if (configuredProjectCount > 0 && sourceSessionCount === 0) {
    return {
      ok: false,
      reason:
        `This install has ${configuredProjectCount} project(s) but the database has no sessions ` +
        `in it. That combination means the database is not the one you have been using. ` +
        `Restore from a backup before migrating.`,
    };
  }

  return { ok: true };
}

/** Minimal read surface needed to count sessions; satisfied by the live worker. */
export interface SourceSessionReader {
  queryReadOnly<T = unknown>(sql: string, params?: unknown[], timeoutMs?: number): Promise<{ rows: T[] }>;
}

/**
 * Collect the facts above from a real install. Impure by necessity, and kept
 * next to the decision so both cutover paths -- migrate and adopt-a-dry-run --
 * ask the same question the same way.
 *
 * Nothing in here may throw: a scan or query that fails yields the permissive
 * value, because a broken check must not become a new way to block a launch.
 */
export async function gatherMigrationSourceFacts(args: {
  userDataPath: string;
  liveDirBytes: number;
  pglite: SourceSessionReader;
  configuredProjectCount?: number;
  findBackups: (userDataPath: string) => Array<{ bytes: number }>;
}): Promise<MigrationSourceFacts> {
  let largestBackupBytes = 0;
  try {
    for (const backup of args.findBackups(args.userDataPath)) {
      if (backup.bytes > largestBackupBytes) largestBackupBytes = backup.bytes;
    }
  } catch {
    // No evidence is the permissive value.
  }

  let sourceSessionCount: number | null = null;
  try {
    const result = await args.pglite.queryReadOnly<{ c: number | string }>(
      'SELECT COUNT(*) AS c FROM ai_sessions',
    );
    const raw = result.rows[0]?.c;
    if (raw !== undefined) sourceSessionCount = Number(raw);
  } catch {
    // Unreadable is not the same as empty, and null says exactly that.
  }

  return {
    liveDirBytes: args.liveDirBytes,
    largestBackupBytes,
    configuredProjectCount: args.configuredProjectCount ?? 0,
    sourceSessionCount,
  };
}

function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
