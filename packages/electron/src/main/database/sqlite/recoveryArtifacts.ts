/**
 * Leftover PGLite directories that record something happening to a user's
 * database, found by a single scan of userData at launch.
 *
 *   - `pglite-db.migrated-*` — a completed migration preserved the old store.
 *     Gates retiring the PGLite reader code.
 *   - `pglite-db.backup-*`   — the worker decided the database was corrupt and
 *     renamed it aside (`worker.js`). Until this was reported there was no
 *     fleet signal for it at all, so an established install could be silently
 *     running on an empty database and nothing upstream would know (#1347).
 *
 * Every filesystem error is swallowed: this feeds telemetry gauges, and none of
 * them should be able to fail a launch because a directory went away mid-scan.
 */

import * as fs from 'fs';
import * as path from 'path';
import { dirSizeBytes } from './dirSize';

export const MIGRATED_DIR_PREFIX = 'pglite-db.migrated-';
export const CORRUPTION_BACKUP_DIR_PREFIX = 'pglite-db.backup-';

export interface RecoveryArtifacts {
  /** Preserved pre-migration stores, newest name last (timestamps sort lexically). */
  migratedDirs: string[];
  /** Databases the worker renamed aside as corrupt, newest name last. */
  corruptionBackupDirs: string[];
}

export function findRecoveryArtifacts(userDataPath: string): RecoveryArtifacts {
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(userDataPath);
  } catch {
    return { migratedDirs: [], corruptionBackupDirs: [] };
  }
  const migratedDirs: string[] = [];
  const corruptionBackupDirs: string[] = [];
  for (const entry of entries) {
    if (entry.startsWith(MIGRATED_DIR_PREFIX)) migratedDirs.push(entry);
    else if (entry.startsWith(CORRUPTION_BACKUP_DIR_PREFIX)) corruptionBackupDirs.push(entry);
  }
  migratedDirs.sort();
  corruptionBackupDirs.sort();
  return { migratedDirs, corruptionBackupDirs };
}

/**
 * Bytes held by the largest renamed-aside database. This is the number that
 * says whether a user has data waiting to be restored: a large value next to a
 * near-empty live `pglite-db/` is the fingerprint of a silent wipe.
 */
export function largestDirBytes(userDataPath: string, dirNames: string[]): number {
  let largest = 0;
  for (const name of dirNames) {
    const bytes = dirSizeBytes(path.join(userDataPath, name));
    if (bytes > largest) largest = bytes;
  }
  return largest;
}

/** Rolling backups written by `DatabaseBackupService`, newest first. */
export const ROLLING_BACKUP_DIR = 'db-backups';
const ROLLING_BACKUP_NAMES = [
  'pglite-db.backup-current',
  'pglite-db.backup-previous',
  'pglite-db.backup-oldest',
];

export interface RestorableBackup {
  /** Absolute path, so the failure dialog can name something the user can find. */
  path: string;
  /** Bare directory name. */
  name: string;
  bytes: number;
}

/**
 * Every copy of the database still on disk, most promising first: the rolling
 * backups in `db-backups/`, then anything the worker renamed aside.
 *
 * Empty directories are excluded — offering a user a 0-byte "backup" during a
 * failed launch is worse than saying nothing. Exists so the database-failure
 * dialog can state what is actually recoverable instead of telling the user to
 * delete the folder (#1347).
 */
export function findRestorableBackups(userDataPath: string): RestorableBackup[] {
  const found: RestorableBackup[] = [];
  const consider = (dir: string, name: string) => {
    const full = path.join(dir, name);
    const bytes = dirSizeBytes(full);
    if (bytes > 0) found.push({ path: full, name, bytes });
  };
  const rollingDir = path.join(userDataPath, ROLLING_BACKUP_DIR);
  for (const name of ROLLING_BACKUP_NAMES) consider(rollingDir, name);
  const { corruptionBackupDirs } = findRecoveryArtifacts(userDataPath);
  for (const name of [...corruptionBackupDirs].reverse()) consider(userDataPath, name);
  return found;
}

/** Compact size for display in a plain-text dialog. */
export function formatBytes(bytes: number): string {
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
