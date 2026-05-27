/**
 * IPC channels that drive the PGLite → SQLite migration UI from Settings.
 *
 * Renderer-side flow:
 *   1. Open Settings → Database → "Migrate to SQLite"
 *   2. Renderer invokes `db:migration:get-status` to populate the pane.
 *   3. Renderer invokes `db:migration:preflight` before showing "Start".
 *   4. Renderer invokes `db:migration:start` to kick off the orchestrator.
 *   5. Main broadcasts `db:migration:progress` / `db:migration:phase` /
 *      `db:migration:complete` / `db:migration:failed` via
 *      `MigrationProgressReporter`. The renderer listens via `electronAPI.on`.
 *
 * The migration is a one-shot operation; we guard with a module-level
 * `runningMigration` flag and reject concurrent start requests.
 */
import { app } from 'electron';
import * as path from 'path';
import { safeHandle } from '../utils/ipcRegistry';
import { logger } from '../utils/logger';
import { database } from '../database/initialize';
import { resolveBackend, readBackendState, commitRollbackToPglite } from '../database/sqlite/BackendSelector';
import { MigrationOrchestrator } from '../database/sqlite/MigrationOrchestrator';
import { MigrationProgressReporter } from '../database/sqlite/MigrationProgressReporter';
import { MigrationDryRunner } from '../database/sqlite/MigrationDryRunner';
import { AnalyticsService } from '../services/analytics/AnalyticsService';
import * as fs from 'fs';

let runningMigration = false;
let runningDryRun = false;

export function getSchemaDir(): string {
  // In dev mode `__dirname` lands at packages/electron/src/main/ipc; the
  // schema file ships alongside the sqlite module. In production the schemas
  // are copied to the same relative location by the bundler.
  return path.resolve(__dirname, '..', 'database', 'sqlite', 'schemas');
}

function getUserDataPath(): string {
  return (
    process.env.NIMBALYST_USER_DATA_PATH
    || app.getPath('userData')
  );
}

export function registerMigrationHandlers(): void {
  safeHandle('db:migration:get-status', async () => {
    try {
      const userDataPath = getUserDataPath();
      const resolved = resolveBackend({ userDataPath });
      const state = readBackendState(userDataPath);
      const pgliteDir = path.join(userDataPath, 'pglite-db');
      const sqliteDir = path.join(userDataPath, 'sqlite-db');
      const migratedDirs = fs
        .readdirSync(userDataPath)
        .filter((d) => d.startsWith('pglite-db.migrated-'));
      return {
        success: true,
        activeBackend: resolved.backend,
        flagState: state,
        pgliteDirExists: fs.existsSync(pgliteDir),
        sqliteDirExists: fs.existsSync(sqliteDir),
        migratedDirs,
        running: runningMigration,
        runningDryRun,
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  safeHandle('db:migration:preflight', async () => {
    try {
      const orch = new MigrationOrchestrator({
        userDataPath: getUserDataPath(),
        schemaDir: getSchemaDir(),
        closeRunningPglite: async () => undefined,
        log: (level, msg, meta) => logger.main[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info'](msg, meta),
      });
      const result = await orch.preflight();
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  safeHandle('db:migration:start', async () => {
    if (runningMigration) {
      return { success: false, error: 'Migration already running.' };
    }
    runningMigration = true;
    const reporter = new MigrationProgressReporter();
    const userDataPath = getUserDataPath();
    try {
      const orch = new MigrationOrchestrator({
        userDataPath,
        schemaDir: getSchemaDir(),
        closeRunningPglite: async () => {
          // The production PGLite handle must be closed before we can re-open
          // it in-process. The exported `database` is a PGLiteDatabaseWorker
          // wrapper; calling close() terminates the worker thread.
          try {
            await database.close();
          } catch (closeErr) {
            logger.main.warn('[Migration] PGLite close failed; proceeding anyway', closeErr);
          }
        },
        onCutoverSuccess: async () => {
          // After cutover, the legacy PGLite handle is invalid. The renderer
          // is expected to relaunch the app to pick up the new SQLiteDatabase
          // under repositoryManager. We log and rely on the UI's "Continue"
          // button to relaunch.
          logger.main.info('[Migration] Cutover complete; relaunch required for SQLite to take effect');
        },
        reporter,
        sendEvent: (eventName, properties) =>
          AnalyticsService.getInstance().sendEvent(eventName, properties),
        log: (level, msg, meta) => logger.main[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info'](msg, meta),
      });
      const summary = await orch.run();
      return { success: true, summary };
    } catch (err) {
      logger.main.error('[Migration] failed', err);
      return { success: false, error: (err as Error).message };
    } finally {
      runningMigration = false;
    }
  });

  // ----- Dry run (alpha) ---------------------------------------------------
  // Runs the full migration into a throwaway directory while the user keeps
  // working. Returns real stats: row counts, per-table breakdown, duration,
  // FK + integrity status, on-disk SQLite size, and the pglite-db/ size for
  // comparison. Never touches pglite-db, never writes the flag. The temp
  // SQLite dir is removed on completion (success or failure).
  safeHandle('db:migration:dry-run', async (_event, opts?: { keepArtifacts?: boolean }) => {
    if (runningDryRun) {
      return { success: false, error: 'Dry run already in progress.' };
    }
    if (runningMigration) {
      return { success: false, error: 'A real migration is in progress; dry run is unavailable.' };
    }
    runningDryRun = true;
    const reporter = new MigrationProgressReporter();
    try {
      const dryRunner = new MigrationDryRunner({
        userDataPath: getUserDataPath(),
        schemaDir: getSchemaDir(),
        // The exported `database` (PGLiteDatabaseWorker) already exposes the
        // single-statement `queryReadOnly` surface the dry runner needs.
        pglite: database,
        reporter,
        keepArtifacts: opts?.keepArtifacts === true,
        log: (level, msg, meta) => logger.main[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info'](msg, meta),
      });
      const result = await dryRunner.run();
      // Telemetry: opt-in like every other migration event; useful for fleet
      // signals before we flip the cutover.
      AnalyticsService.getInstance().sendEvent('migration_dry_run_completed', {
        target_row_count: result.summary.totalRowsCopied,
        duration_ms: Math.round(result.summary.durationMs),
        tables_migrated: result.summary.tablesCopied.length,
        sqlite_file_bytes: result.sqliteFileBytes,
        pglite_dir_bytes: result.pgliteDirBytes,
        foreign_key_violations: result.summary.foreignKeyViolations,
        integrity_check: result.summary.integrityCheck,
      });
      return { success: true, result };
    } catch (err) {
      AnalyticsService.getInstance().sendEvent('migration_dry_run_failed', {
        message: (err as Error).message.slice(0, 500),
      });
      return { success: false, error: (err as Error).message };
    } finally {
      runningDryRun = false;
    }
  });

  safeHandle('db:migration:rollback', async () => {
    try {
      const userDataPath = getUserDataPath();
      const migrated = fs
        .readdirSync(userDataPath)
        .filter((d) => d.startsWith('pglite-db.migrated-'))
        .sort()
        .pop();
      if (!migrated) {
        return { success: false, error: 'No preserved PGLite directory to roll back to.' };
      }
      const pgliteDir = path.join(userDataPath, 'pglite-db');
      const sqliteDir = path.join(userDataPath, 'sqlite-db');
      if (fs.existsSync(pgliteDir)) {
        return { success: false, error: 'pglite-db/ already exists; refusing to overwrite.' };
      }
      // Move SQLite aside (don't delete; user may want to reinspect)
      if (fs.existsSync(sqliteDir)) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        fs.renameSync(sqliteDir, path.join(userDataPath, `sqlite-db.rolledback-${stamp}`));
      }
      fs.renameSync(path.join(userDataPath, migrated), pgliteDir);
      commitRollbackToPglite(userDataPath);
      return { success: true, restoredFrom: migrated };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  logger.main.info('[MigrationHandlers] Registered');
}
