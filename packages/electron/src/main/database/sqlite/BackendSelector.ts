/**
 * BackendSelector
 *
 * Single source of truth for whether the local store runs on PGLite or SQLite.
 *
 * Decision rules:
 *   - Existing installs (have `pglite-db/`): migration is *due*. The boot path
 *     migrates them automatically (see `autoMigrate.ts`); they no longer wait
 *     for the user to opt in from Settings.
 *   - Except installs that explicitly rolled back (`setBy: 'rollback'`). Those
 *     stay on PGLite forever — the user already told us SQLite went badly for
 *     them, and silently dragging them back would be the worst possible bug.
 *   - Fresh installs (no `pglite-db/`): default to SQLite immediately.
 *   - The setting is persisted in a small JSON file at
 *     `<userData>/database-backend.json` rather than the main electron-store
 *     schema so we don't have to migrate the AppStoreSchema for a flag that
 *     turns over once per install.
 *
 * Writers: the migration flow (manual and automatic) flips `backend`, and the
 * auto-migration path additionally records attempt bookkeeping and the cached
 * kill-switch value. All writes go through `writeBackendState`, which is
 * atomic — a torn file here reads back as `null` and silently degrades to disk
 * inference, which during an auto-migration would mean re-migrating an install
 * that had already cut over.
 */

import * as fs from 'fs';
import * as path from 'path';

export type DatabaseBackend = 'pglite' | 'sqlite';

/**
 * Consecutive auto-migration failures. Reset on success; once `count` reaches
 * MAX_AUTO_MIGRATION_ATTEMPTS the boot path stops trying and leaves the user
 * on PGLite with the manual Settings flow.
 */
export interface MigrationAttempts {
  count: number;
  lastAttemptAt: string;
  lastErrorCode?: string;
}

export const MAX_AUTO_MIGRATION_ATTEMPTS = 3;

export interface BackendState {
  backend: DatabaseBackend;
  /** ISO timestamp the flag was last written. */
  setAt: string;
  /** Was this set automatically (fresh install) or by an explicit migration? */
  setBy:
    | 'auto-fresh-install'
    | 'user-migration'
    | 'auto-migration'
    | 'auto-migration-deferred'
    | 'rollback';
  /** Optional pointer to the preserved pre-migration PGLite directory. */
  pgliteMigratedDir?: string;
  /** Auto-migration back-off bookkeeping. Absent until the first failure. */
  migrationAttempts?: MigrationAttempts;
  /**
   * Last known value of the `force-sqlite-migration` kill switch. Cached here
   * because the boot path cannot wait on the network to ask PostHog; see
   * `migrationFlag.ts`.
   */
  forceMigrationFlag?: boolean;
}

const FLAG_FILE_NAME = 'database-backend.json';

export function getFlagPath(userDataPath: string): string {
  return path.join(userDataPath, FLAG_FILE_NAME);
}

export function readBackendState(userDataPath: string): BackendState | null {
  const flagPath = getFlagPath(userDataPath);
  if (!fs.existsSync(flagPath)) return null;
  try {
    const raw = fs.readFileSync(flagPath, 'utf-8');
    const parsed = JSON.parse(raw) as BackendState;
    if (parsed.backend !== 'pglite' && parsed.backend !== 'sqlite') return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Write the flag atomically. A partially-written file parses as `null`, which
 * `resolveBackend` treats as "no flag" and falls back to disk inference — for
 * an install that has already cut over, that would look like a fresh PGLite
 * migration candidate. Write to a sibling temp file and rename, which is
 * atomic within a directory on every platform we ship.
 */
export function writeBackendState(userDataPath: string, state: BackendState): void {
  fs.mkdirSync(userDataPath, { recursive: true });
  const flagPath = getFlagPath(userDataPath);
  const tmpPath = `${flagPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
  fs.renameSync(tmpPath, flagPath);
}

/**
 * Merge a partial update into the existing state without losing sibling fields.
 *
 * Returns `null` without writing when there is no state yet and the patch does
 * not name a backend. Choosing a backend is `resolveBackend`'s job; a caller
 * updating a sibling field must never decide it as a side effect. This used to
 * default to `pglite`, which meant the kill-switch cache refresh — it runs on
 * every launch, including a fresh install's first — wrote "pglite" into the
 * flag file of an install that had just resolved to SQLite, pinning it to a
 * PGLite database it should never have had (#1347).
 */
export function updateBackendState(
  userDataPath: string,
  patch: Partial<BackendState>,
): BackendState | null {
  const current = readBackendState(userDataPath);
  if (!current) {
    if (!patch.backend || !patch.setBy) return null;
    const created: BackendState = {
      ...patch,
      backend: patch.backend,
      setBy: patch.setBy,
      setAt: new Date().toISOString(),
    };
    writeBackendState(userDataPath, created);
    return created;
  }
  const next: BackendState = { ...current, ...patch };
  writeBackendState(userDataPath, next);
  return next;
}

export interface ResolveBackendInput {
  userDataPath: string;
}

export type BackendReason =
  | 'flag-file-pglite-rollback'
  | 'flag-file-sqlite'
  | 'fresh-install-defaults-sqlite'
  | 'existing-pglite-migration-due';

export interface ResolvedBackend {
  backend: DatabaseBackend;
  reason: BackendReason;
  state: BackendState | null;
  /**
   * True when this install should be auto-migrated on this launch, subject to
   * the kill switch and back-off that `maybeAutoMigrate` applies. Rollback
   * installs are never due.
   */
  migrationDue: boolean;
}

/**
 * Resolve which backend should be active on launch. Reads the filesystem;
 * never writes (the migration flow does that).
 *
 * Decision tree:
 *   1. Flag file says sqlite -> SQLite. Done, nothing due.
 *   2. Flag file says pglite via `rollback` -> PGLite, permanently. The user
 *      migrated, hit a problem, and chose to go back. Never auto-migrate them.
 *   3. Flag file says pglite any other way (a deferred/backed-off auto
 *      migration) -> PGLite, migration due.
 *   4. No flag file but `pglite-db/` exists -> PGLite, migration due.
 *   5. Otherwise -> fresh install, SQLite.
 */
export function resolveBackend(input: ResolveBackendInput): ResolvedBackend {
  const state = readBackendState(input.userDataPath);
  if (state) {
    if (state.backend === 'sqlite') {
      return { backend: 'sqlite', reason: 'flag-file-sqlite', state, migrationDue: false };
    }
    if (state.setBy === 'rollback') {
      return {
        backend: 'pglite',
        reason: 'flag-file-pglite-rollback',
        state,
        migrationDue: false,
      };
    }
    return {
      backend: 'pglite',
      reason: 'existing-pglite-migration-due',
      state,
      migrationDue: true,
    };
  }
  const pgliteDir = path.join(input.userDataPath, 'pglite-db');
  if (fs.existsSync(pgliteDir)) {
    return {
      backend: 'pglite',
      reason: 'existing-pglite-migration-due',
      state: null,
      migrationDue: true,
    };
  }
  return {
    backend: 'sqlite',
    reason: 'fresh-install-defaults-sqlite',
    state: null,
    migrationDue: false,
  };
}

/** Called by the migration flow at the cutover step. */
export function commitMigrationToSqlite(
  userDataPath: string,
  pgliteMigratedDir: string,
  setBy: 'user-migration' | 'auto-migration' = 'user-migration',
): void {
  writeBackendState(userDataPath, {
    backend: 'sqlite',
    setAt: new Date().toISOString(),
    setBy,
    pgliteMigratedDir,
  });
}

/** Record a failed auto-migration attempt so the back-off can count it. */
export function recordAutoMigrationFailure(userDataPath: string, errorCode: string): number {
  const previous = readBackendState(userDataPath)?.migrationAttempts?.count ?? 0;
  const count = previous + 1;
  updateBackendState(userDataPath, {
    backend: 'pglite',
    setBy: 'auto-migration-deferred',
    migrationAttempts: { count, lastAttemptAt: new Date().toISOString(), lastErrorCode: errorCode },
  });
  return count;
}

/** Has this install exhausted its automatic attempts? */
export function hasExhaustedAutoMigration(state: BackendState | null): boolean {
  return (state?.migrationAttempts?.count ?? 0) >= MAX_AUTO_MIGRATION_ATTEMPTS;
}

/** Called by the rollback flow from Settings → Database → Restore PGLite. */
export function commitRollbackToPglite(userDataPath: string): void {
  writeBackendState(userDataPath, {
    backend: 'pglite',
    setAt: new Date().toISOString(),
    setBy: 'rollback',
  });
}

/** Called once on a fresh install where no pglite-db directory exists. */
export function commitFreshInstallSqlite(userDataPath: string): void {
  writeBackendState(userDataPath, {
    backend: 'sqlite',
    setAt: new Date().toISOString(),
    setBy: 'auto-fresh-install',
  });
}
