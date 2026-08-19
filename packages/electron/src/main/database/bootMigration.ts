/**
 * Wiring for the boot-time forced migration.
 *
 * `autoMigrate.ts` owns the decision ("should this launch migrate?").
 * This module owns the plumbing around it: adapting the SQLite worker proxy to
 * the orchestrator surface, driving the splash screen, and relaunching. It
 * lives here rather than in `initialize.ts` because that file is already large
 * and this is a self-contained concern.
 */

import { app } from 'electron';

import { maybeAutoMigrate, type OrchestratorLike } from './sqlite/autoMigrate';
import { readCachedMigrationFlag } from './sqlite/migrationFlag';
import type { ResolvedBackend } from './sqlite/BackendSelector';
import type { SQLiteDatabaseProxy } from './sqlite/SQLiteDatabaseProxy';
import type { MigrationProgress } from './sqlite/PGLiteToSQLiteMigrator';
import {
  enterSplashMigrationMode,
  updateSplashMigrationProgress,
} from '../window/SplashScreen';
import { buildSplashView } from '../window/migrationProgressView';
import { AnalyticsService } from '../services/analytics/AnalyticsService';
import { logger } from '../utils/logger';

/**
 * Run the forced migration if this launch is due for one.
 *
 * Returns true when the migration succeeded and a relaunch has been requested,
 * in which case the caller must stop initializing — the process is going away.
 * Every other outcome returns false and the caller carries on with PGLite.
 */
export async function runForcedMigration(args: {
  userDataPath: string;
  schemaDir: string;
  resolved: ResolvedBackend;
  proxy: SQLiteDatabaseProxy;
}): Promise<boolean> {
  const { userDataPath, schemaDir, resolved, proxy } = args;

  let lastPercent = 0;
  let splashArmed = false;
  proxy.setMigrationObserver((event, payload) => {
    if (event !== 'db:migration:progress' && event !== 'db:migration:phase') return;
    const progress = (event === 'db:migration:phase'
      ? (payload as { info?: MigrationProgress }).info
      : (payload as MigrationProgress));
    if (!progress) return;
    // Arm the splash on the first real frame rather than up front, so a
    // migration that dies in pre-flight never flashes a progress bar.
    if (!splashArmed) {
      splashArmed = true;
      enterSplashMigrationMode();
    }
    const view = buildSplashView(progress, lastPercent);
    lastPercent = view.percent;
    updateSplashMigrationProgress(view);
  });

  const orchestrator: OrchestratorLike = {
    preflight: () => proxy.migrationPreflight({ userDataPath, schemaDir }),
    run: async () => {
      const { summary } = await proxy.startMigration({ userDataPath, schemaDir });
      return summary;
    },
  };

  const outcome = await maybeAutoMigrate({
    userDataPath,
    resolved,
    isFlagEnabled: () => readCachedMigrationFlag(userDataPath),
    orchestrator,
    relaunch: () => {
      // Under Playwright, relaunching would spawn a second Electron that the
      // test runner does not own and cannot clean up. Quit instead; the spec
      // asserts the on-disk end state and then launches again itself.
      if (process.env.PLAYWRIGHT !== '1') {
        app.relaunch();
      }
      app.quit();
    },
    sendEvent: (event, properties) =>
      AnalyticsService.getInstance().sendEvent(event, properties),
    log: (level, msg, meta) => logger.main[level](msg, meta),
  });

  if (outcome.action === 'migrated') {
    AnalyticsService.getInstance().sendEvent('migration_completed', {
      target_row_count: outcome.summary.totalRowsCopied,
      duration_ms: Math.round(outcome.summary.durationMs),
      tables_migrated: outcome.summary.tablesCopied.length,
      spot_check_count: outcome.summary.spotCheckCount,
      foreign_key_violations: outcome.summary.foreignKeyViolations,
      integrity_check: outcome.summary.integrityCheck,
      trigger: 'auto',
    });
    return true;
  }

  return false;
}
