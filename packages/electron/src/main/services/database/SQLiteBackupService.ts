/**
 * SQLiteBackupService
 *
 * SQLite analog of DatabaseBackupService. Same surface (initialize,
 * createBackup, restoreFromBackup, hasBackups, getBackupStatus,
 * cleanupOldCorruptedBackups), same rolling-3 strategy, same size-guard
 * heuristic — but the backup mechanism is SQLite's Online Backup API
 * (`db.backup()`) instead of a recursive directory copy.
 *
 * Why a sibling class instead of a shared adapter: the PGLite-side service
 * is already in production and getting touched by other tracks; coupling
 * the two would balloon the migration's blast radius. The plan calls for
 * branching at the backend selector, which is exactly what this delivers.
 */
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import type { SQLiteDatabase } from '../../database/sqlite/SQLiteDatabase';

export type SQLiteBackupLogFn = (
  level: 'info' | 'warn' | 'error',
  msg: string,
  meta?: unknown,
) => void;

interface BackupSlotMetadata {
  timestamp: string;
  sizeBytes: number;
  verified: boolean;
}

interface BackupMetadata {
  currentBackup: BackupSlotMetadata | null;
  previousBackup: BackupSlotMetadata | null;
  oldestBackup: BackupSlotMetadata | null;
  lastBackupAttempt: string | null;
  lastSuccessfulBackup: string | null;
}

const BACKUP_FILENAMES = {
  current: 'nimbalyst.backup-current.sqlite',
  previous: 'nimbalyst.backup-previous.sqlite',
  oldest: 'nimbalyst.backup-oldest.sqlite',
} as const;

/** Newest to oldest. `rotateBackups` truncates this to the retention setting. */
const BACKUP_SLOT_ORDER = ['current', 'previous', 'oldest'] as const;

type BackupSlot = (typeof BACKUP_SLOT_ORDER)[number];

const SLOT_METADATA_KEYS = {
  current: 'currentBackup',
  previous: 'previousBackup',
  oldest: 'oldestBackup',
} as const satisfies Record<BackupSlot, keyof BackupMetadata>;

/**
 * Generations kept, each a full copy of the database. Two keeps one older
 * generation to fall back on if the newest backup is itself bad, at a 3x
 * total disk multiplier instead of the 4x that prompted #1248.
 */
export const DEFAULT_BACKUP_COPIES_KEPT = 2;
export const MAX_BACKUP_COPIES_KEPT = BACKUP_SLOT_ORDER.length;

const METADATA_FILENAME = 'backup-metadata.json';
const SIZE_GUARD_RATIO = 0.5;

/** A bad setting must never mean "keep zero backups". */
function clampCopiesKept(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_BACKUP_COPIES_KEPT;
  return Math.max(1, Math.min(MAX_BACKUP_COPIES_KEPT, Math.floor(value)));
}

export interface SQLiteBackupServiceOptions {
  /** Directory holding `nimbalyst.sqlite`. */
  sqliteDir: string;
  /** Directory under userData for backups. Typically `<userData>/sqlite-db.backups`. */
  backupDir: string;
  /** Reference to the live SQLiteDatabase for online backup + verification. */
  sqlite: SQLiteDatabase;
  /**
   * Optional log sink. Injected because this class runs inside the SQLite
   * worker_threads worker, where `electron-log/main` cannot be required (no
   * `electron` module resolution from a worker bundle). The worker passes its
   * own `emit('log', …)` sink; main-process callers may pass an
   * `electron-log` wrapper. Defaults to a no-op when not provided.
   */
  log?: SQLiteBackupLogFn;
  /**
   * Backup generations to keep (1-3). Defaults to
   * `DEFAULT_BACKUP_COPIES_KEPT`. Each is a full copy, so this is a direct
   * multiplier on disk usage.
   */
  copiesKept?: number;
}

export class SQLiteBackupService {
  private sqliteDir: string;
  private backupDir: string;
  private sqlite: SQLiteDatabase;
  private metadataPath: string;
  private log: SQLiteBackupLogFn;
  private copiesKept: number;
  private metadata: BackupMetadata = {
    currentBackup: null,
    previousBackup: null,
    oldestBackup: null,
    lastBackupAttempt: null,
    lastSuccessfulBackup: null,
  };

  constructor(opts: SQLiteBackupServiceOptions) {
    this.sqliteDir = opts.sqliteDir;
    this.backupDir = opts.backupDir;
    this.sqlite = opts.sqlite;
    this.metadataPath = path.join(this.backupDir, METADATA_FILENAME);
    this.log = opts.log ?? (() => { /* no-op */ });
    this.copiesKept = clampCopiesKept(opts.copiesKept);
  }

  /**
   * Change how many generations are kept. The new limit takes effect on the
   * next rotation, which is also when slots past the limit are deleted.
   */
  setCopiesKept(copiesKept: number): void {
    this.copiesKept = clampCopiesKept(copiesKept);
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.backupDir, { recursive: true });
    await this.loadMetadata();
    this.log('info', '[SQLite Backup] Initialized', {
      backupDir: this.backupDir,
      hasCurrent: !!this.metadata.currentBackup,
      hasPrevious: !!this.metadata.previousBackup,
      hasOldest: !!this.metadata.oldestBackup,
    });
  }

  /**
   * Create a verified online backup of the live database.
   * Uses better-sqlite3's `db.backup()` which calls the SQLite Online Backup
   * API — safe under concurrent writes, no locking required.
   */
  async createBackup(): Promise<{ success: boolean; error?: string }> {
    this.metadata.lastBackupAttempt = new Date().toISOString();

    // Declared outside the try so the catch can clean up the temp .sqlite and
    // its WAL/SHM siblings on partial failure.
    let tempPath: string | null = null;

    try {
      const liveDb = this.sqlite.getRawHandle();
      if (!liveDb) {
        return { success: false, error: 'SQLite database not initialized' };
      }
      // The captured handle reference can be closed under us while the
      // backup is in flight (shutdown runs close() right after awaiting our
      // caller). better-sqlite3's backup() schedules step() via setImmediate
      // and throws "database connection is not open" from inside the
      // immediate when the handle was closed in the meantime. Bail before
      // we hand control to setImmediate.
      if (!liveDb.open) {
        return { success: false, error: 'SQLite database connection is closed' };
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      tempPath = path.join(this.backupDir, `temp-backup-${timestamp}.sqlite`);

      this.log('info', '[SQLite Backup] Starting online backup', { tempPath });
      await liveDb.backup(tempPath);
      const sizeBytes = (await fs.stat(tempPath)).size;
      this.log('info', '[SQLite Backup] Online backup complete', { sizeBytes });

      const verification = await this.sqlite.verifyBackup(tempPath);
      if (!verification.valid) {
        await this.removeTempBackup(tempPath);
        return { success: false, error: `Verification failed: ${verification.error}` };
      }

      const rotated = await this.rotateBackups(tempPath, timestamp, sizeBytes);
      // better-sqlite3's online backup opens the destination in WAL mode
      // and leaves `.sqlite-shm`/`.sqlite-wal` siblings next to the file.
      // The rotation moves the main file but the siblings stay behind —
      // accumulating one shm+wal pair per backup. Clean them up here.
      // (If rotation rejected due to size guard, it already removed the
      // main file; the siblings still need cleaning.)
      await this.removeTempBackupSiblings(tempPath);
      if (rotated) {
        this.metadata.lastSuccessfulBackup = timestamp;
      }
      await this.saveMetadata();
      this.log('info', '[SQLite Backup] Backup finished', { rotated });
      return { success: true };
    } catch (err) {
      this.log('error', '[SQLite Backup] Failed to create backup', err);
      if (tempPath) {
        await this.removeTempBackup(tempPath);
      }
      await this.saveMetadata();
      return { success: false, error: (err as Error).message };
    }
  }

  /**
   * Restore from the newest valid backup. Closes the live database first,
   * copies the backup file over `nimbalyst.sqlite`, leaves it to the caller
   * to re-open via the normal startup path.
   */
  async restoreFromBackup(): Promise<{
    success: boolean;
    error?: string;
    source?: 'current' | 'previous' | 'oldest';
  }> {
    const candidates: ('current' | 'previous' | 'oldest')[] = ['current', 'previous', 'oldest'];
    for (const slot of candidates) {
      const p = path.join(this.backupDir, BACKUP_FILENAMES[slot]);
      if (!fsSync.existsSync(p)) continue;
      const result = await this.restoreFromPath(p, slot);
      if (result.success) return { ...result, source: slot };
    }
    return { success: false, error: 'No valid backups available' };
  }

  hasBackups(): boolean {
    return (Object.values(BACKUP_FILENAMES) as string[])
      .some((name) => fsSync.existsSync(path.join(this.backupDir, name)));
  }

  getBackupStatus(): BackupMetadata {
    return { ...this.metadata };
  }

  /**
   * Remove stranded `temp-backup-*` files in the backup folder. Catches the
   * `.sqlite`, `.sqlite-shm`, and `.sqlite-wal` siblings left behind by
   * older builds or by partial failures. Per-call cleanup in createBackup()
   * keeps the steady-state empty, so this is a safety net for upgrades.
   */
  async cleanupOldCorruptedBackups(): Promise<void> {
    try {
      const entries = await fs.readdir(this.backupDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (!entry.name.startsWith('temp-backup-')) continue;
        const full = path.join(this.backupDir, entry.name);
        this.log('info', '[SQLite Backup] Removing stranded temp file', { name: entry.name });
        await fs.rm(full, { force: true });
      }
    } catch (err) {
      this.log('warn', '[SQLite Backup] Cleanup failed', err);
    }
  }

  /** Remove a temp .sqlite file and its WAL/SHM siblings. */
  private async removeTempBackup(tempPath: string): Promise<void> {
    await fs.rm(tempPath, { force: true });
    await this.removeTempBackupSiblings(tempPath);
  }

  /** Remove only the WAL/SHM siblings (used after a successful rename of the main file). */
  private async removeTempBackupSiblings(tempPath: string): Promise<void> {
    await fs.rm(`${tempPath}-wal`, { force: true });
    await fs.rm(`${tempPath}-shm`, { force: true });
  }

  // --------------------------------------------------------------------------
  // Internal
  // --------------------------------------------------------------------------

  private async loadMetadata(): Promise<void> {
    try {
      const raw = await fs.readFile(this.metadataPath, 'utf-8');
      this.metadata = JSON.parse(raw);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      this.log('warn', '[SQLite Backup] Failed to load metadata', err);
    }
  }

  private async saveMetadata(): Promise<void> {
    try {
      await fs.writeFile(this.metadataPath, JSON.stringify(this.metadata, null, 2), 'utf-8');
    } catch (err) {
      this.log('error', '[SQLite Backup] Failed to save metadata', err);
    }
  }

  /**
   * Roll the backup chain, keeping `copiesKept` generations.
   *
   * At the default of 2 this is: previous is deleted, current → previous,
   * new → current. Every kept copy is a FULL copy of the database, so this
   * setting is a direct multiplier on disk: 3 copies plus the live database
   * meant a 4.6 GiB store occupied 18.5 GiB (#1248).
   *
   * Size-guard rejects suspicious shrinkage before anything is moved.
   */
  private async rotateBackups(
    newPath: string,
    timestamp: string,
    sizeBytes: number,
  ): Promise<boolean> {
    const currentSize = this.metadata.currentBackup?.sizeBytes ?? 0;
    if (currentSize > 0 && sizeBytes / currentSize < SIZE_GUARD_RATIO) {
      this.log('warn', '[SQLite Backup] New backup suspiciously smaller; rejecting rotation', {
        sizeBytes,
        currentSize,
        ratio: (sizeBytes / currentSize).toFixed(2),
      });
      await fs.rm(newPath, { force: true });
      return false;
    }

    // Slots from newest to oldest, truncated to the retention setting. Slots
    // past the limit are removed so lowering the setting actually reclaims the
    // space rather than orphaning files in the backup directory.
    const slots = BACKUP_SLOT_ORDER.slice(0, this.copiesKept);
    const dropped = BACKUP_SLOT_ORDER.slice(this.copiesKept);
    for (const slot of dropped) {
      const p = path.join(this.backupDir, BACKUP_FILENAMES[slot]);
      if (fsSync.existsSync(p)) {
        await fs.rm(p, { force: true });
        this.log('info', `[SQLite Backup] Removed ${slot} backup (retention set to ${this.copiesKept})`);
      }
      this.metadata[SLOT_METADATA_KEYS[slot]] = null;
    }

    // Shift each kept slot down one, oldest first so nothing is overwritten.
    for (let i = slots.length - 1; i > 0; i--) {
      const target = slots[i];
      const sourceSlot = slots[i - 1];
      const targetPath = path.join(this.backupDir, BACKUP_FILENAMES[target]);
      const sourcePath = path.join(this.backupDir, BACKUP_FILENAMES[sourceSlot]);
      if (fsSync.existsSync(targetPath)) {
        await fs.rm(targetPath, { force: true });
      }
      if (fsSync.existsSync(sourcePath)) {
        await fs.rename(sourcePath, targetPath);
        this.metadata[SLOT_METADATA_KEYS[target]] = this.metadata[SLOT_METADATA_KEYS[sourceSlot]];
      }
    }

    // At copiesKept === 1 there is no older generation to fall back on, so the
    // new backup is still written to a temp file and promoted by rename --
    // never truncated in place.
    const currentPath = path.join(this.backupDir, BACKUP_FILENAMES.current);
    if (this.copiesKept === 1 && fsSync.existsSync(currentPath)) {
      await fs.rm(currentPath, { force: true });
    }
    await fs.rename(newPath, currentPath);
    this.metadata.currentBackup = { timestamp, sizeBytes, verified: true };
    return true;
  }

  private async restoreFromPath(
    backupPath: string,
    source: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const verification = await this.sqlite.verifyBackup(backupPath);
      if (!verification.valid) {
        return { success: false, error: `${source} verification failed: ${verification.error}` };
      }

      this.log('info', `[SQLite Backup] Closing live db before restore from ${source}`);
      await this.sqlite.close();

      const livePath = path.join(this.sqliteDir, 'nimbalyst.sqlite');
      const walPath = `${livePath}-wal`;
      const shmPath = `${livePath}-shm`;
      // Remove the active DB + WAL/SHM siblings so we restore a clean state.
      for (const p of [livePath, walPath, shmPath]) {
        if (fsSync.existsSync(p)) await fs.rm(p, { force: true });
      }
      await fs.copyFile(backupPath, livePath);
      this.log('info', `[SQLite Backup] Restored from ${source}`);
      return { success: true };
    } catch (err) {
      this.log('error', `[SQLite Backup] Restore from ${source} failed`, err);
      return { success: false, error: (err as Error).message };
    }
  }
}
