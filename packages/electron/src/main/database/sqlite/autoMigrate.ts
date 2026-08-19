/**
 * Boot-time forced migration from PGLite to SQLite.
 *
 * This is a second caller of the existing migration pipeline, not a new one.
 * `MigrationOrchestrator` does all the work; this module owns only the
 * question "should we run it on this launch, and what happens if it fails".
 *
 * The governing constraint is that a blocked boot is worse than a slow one.
 * Every path out of here that isn't a successful cutover must leave the caller
 * able to open PGLite and carry on. The orchestrator already guarantees the
 * source store is untouched on every pre-cutover failure; this module must not
 * add a way to lose that.
 */

import {
  commitMigrationToSqlite,
  hasExhaustedAutoMigration,
  readBackendState,
  recordAutoMigrationFailure,
  updateBackendState,
  type ResolvedBackend,
} from './BackendSelector';
import type { PreflightResult } from './MigrationOrchestrator';
import type { MigrationSummary } from './PGLiteToSQLiteMigrator';
import { classifyDatabaseError } from '../DatabaseErrorTelemetry';

/** The slice of `MigrationOrchestrator` this module depends on. */
export interface OrchestratorLike {
  preflight(): Promise<PreflightResult>;
  run(): Promise<MigrationSummary>;
}

export type AutoMigrateSkipReason =
  | 'not-due'
  | 'flag-unknown'
  | 'flag-disabled'
  | 'backed-off'
  | 'preflight-failed';

export type AutoMigrateOutcome =
  | { action: 'skipped'; reason: AutoMigrateSkipReason; detail?: string }
  | { action: 'migrated'; summary: MigrationSummary }
  | { action: 'failed'; errorCode: string };

export interface AutoMigrateInput {
  userDataPath: string;
  /** The already-computed resolution for this launch. */
  resolved: ResolvedBackend;
  /** Cached kill-switch value; `null` means "we have never resolved it". */
  isFlagEnabled: () => boolean | null;
  orchestrator: OrchestratorLike;
  /** Restart the app so the new backend is picked up. */
  relaunch: () => void;
  sendEvent?: (eventName: string, properties: Record<string, unknown>) => void;
  log?: (level: 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void;
}

export async function maybeAutoMigrate(input: AutoMigrateInput): Promise<AutoMigrateOutcome> {
  const { userDataPath, resolved, orchestrator, relaunch } = input;
  const log = input.log ?? (() => {});
  const emit = input.sendEvent ?? (() => {});

  const skip = (reason: AutoMigrateSkipReason, detail?: string): AutoMigrateOutcome => {
    log('info', `[autoMigrate] skipping (${reason})`, detail);
    return detail ? { action: 'skipped', reason, detail } : { action: 'skipped', reason };
  };

  if (!resolved.migrationDue) {
    return skip('not-due');
  }

  // Back-off before the kill switch: an install that has already failed three
  // times should stop even if the flag is on.
  if (hasExhaustedAutoMigration(resolved.state ?? readBackendState(userDataPath))) {
    return skip('backed-off');
  }

  const flag = input.isFlagEnabled();
  if (flag === null) {
    return skip('flag-unknown');
  }
  if (flag === false) {
    return skip('flag-disabled');
  }

  // Pre-flight is about the environment (disk space, a readable source), not
  // about the migration being broken, so a failure here deliberately does not
  // consume one of the three attempts -- freeing up disk should be enough to
  // let the next launch try again.
  let preflight: PreflightResult;
  try {
    preflight = await orchestrator.preflight();
  } catch (err) {
    log('warn', '[autoMigrate] pre-flight threw; booting on PGLite', err);
    return skip('preflight-failed', err instanceof Error ? err.message : String(err));
  }
  if (!preflight.ok) {
    log('warn', `[autoMigrate] pre-flight failed: ${preflight.reason}`);
    emit('migration_auto_preflight_failed', {
      reason_code: preflight.freeBytes < preflight.requiredBytes ? 'disk_space' : 'other',
      pglite_dir_size_bytes: preflight.pgliteDirBytes,
    });
    return skip('preflight-failed', preflight.reason);
  }

  log('info', '[autoMigrate] starting forced migration', {
    pgliteDirBytes: preflight.pgliteDirBytes,
  });

  try {
    const summary = await orchestrator.run();
    // The orchestrator writes the flag itself on a successful cutover, but it
    // records `user-migration`. Re-stamp it so telemetry can tell a forced
    // migration from one somebody chose, and clear the attempt counter.
    const state = readBackendState(userDataPath);
    if (state?.backend === 'sqlite') {
      updateBackendState(userDataPath, {
        setBy: 'auto-migration',
        migrationAttempts: undefined,
      });
    } else {
      commitMigrationToSqlite(userDataPath, state?.pgliteMigratedDir ?? '', 'auto-migration');
    }

    log('info', '[autoMigrate] migration complete; relaunching');
    relaunch();
    return { action: 'migrated', summary };
  } catch (err) {
    const { errorCode } = classifyDatabaseError(err);
    const attempts = recordAutoMigrationFailure(userDataPath, errorCode);
    log('error', `[autoMigrate] migration failed (attempt ${attempts}); booting on PGLite`, err);
    emit('migration_auto_failed', {
      error_code: errorCode,
      attempt: attempts,
      gave_up: attempts >= 3,
    });
    return { action: 'failed', errorCode };
  }
}
