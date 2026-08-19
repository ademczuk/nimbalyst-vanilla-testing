/**
 * Kill switch for the forced PGLite → SQLite migration.
 *
 * The boot path decides whether to auto-migrate before the database is open
 * and long before anything is on screen, so it cannot wait on a network round
 * trip to PostHog. Instead:
 *
 *   - The last known flag value is cached on disk in `database-backend.json`,
 *     alongside the backend selection it gates.
 *   - The boot path reads only that cache, synchronously.
 *   - A background refresh updates the cache for the *next* launch.
 *
 * An install with no cached value does not migrate on that launch. That is
 * deliberate and fails safe in both directions: an offline user still migrates
 * once they have connected at least once, and turning the flag off actually
 * stops new migrations instead of racing the refresh against the boot path.
 */

import { readBackendState, updateBackendState } from './BackendSelector';
import { AnalyticsService } from '../../services/analytics/AnalyticsService';
import { logger } from '../../utils/logger';

export const FORCE_MIGRATION_FLAG = 'force-sqlite-migration';

/**
 * The cached kill-switch value: `true`/`false` if we have ever resolved it,
 * `null` if we have not. Synchronous by design — this runs on the boot path.
 */
export function readCachedMigrationFlag(userDataPath: string): boolean | null {
  return readBackendState(userDataPath)?.forceMigrationFlag ?? null;
}

/**
 * Refresh the cached flag for the next launch. Fire-and-forget: callers must
 * not await this on the boot path. Leaves the cache untouched when the answer
 * is unknown, so a transient network failure can't look like "flag off".
 */
export function refreshMigrationFlagInBackground(userDataPath: string): void {
  void (async () => {
    try {
      const value = await AnalyticsService.getInstance().getFeatureFlag(FORCE_MIGRATION_FLAG);
      if (value === null) return;
      if (readCachedMigrationFlag(userDataPath) === value) return;
      updateBackendState(userDataPath, { forceMigrationFlag: value });
      logger.main.info(`[Migration] Cached kill-switch value updated to ${value}`);
    } catch (err) {
      logger.main.warn('[Migration] Kill-switch refresh failed', err);
    }
  })();
}
