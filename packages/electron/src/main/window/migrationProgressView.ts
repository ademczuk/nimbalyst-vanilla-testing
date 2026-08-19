/**
 * Turns raw `MigrationProgress` into what the splash screen shows.
 *
 * Kept free of Electron so the arithmetic — which is the part that can
 * actually be wrong — is testable without a BrowserWindow.
 *
 * Two properties matter to a user staring at this for several minutes:
 *
 *   1. The bar never goes backwards. The migrator reports `percentOfTotal`
 *      per phase, so a naive pass-through resets to 0% seven times. Each
 *      phase is mapped into its own slice of the whole instead, and the
 *      result is clamped against the last value emitted.
 *   2. The ETA is either trustworthy or absent. It appears only once there
 *      is a real throughput sample, and is rounded coarsely — a precise
 *      countdown that jitters reads as broken.
 */

import type { MigrationProgress, MigrationPhase } from '../database/sqlite/PGLiteToSQLiteMigrator';

/**
 * Where each phase starts and ends on the overall bar. Copying owns the bulk
 * because it is the only phase whose duration scales with database size; the
 * verification phases are near-constant regardless of row count.
 */
const PHASE_BANDS: Record<MigrationPhase, [number, number]> = {
  preparing: [0, 2],
  copying: [2, 80],
  'rebuilding-fts': [80, 88],
  'verifying-counts': [88, 92],
  'verifying-integrity': [92, 95],
  'verifying-foreign-keys': [95, 97],
  'verifying-spot-check': [97, 99],
  finalizing: [99, 100],
};

const PHASE_LABELS: Record<MigrationPhase, string> = {
  preparing: 'Preparing',
  copying: 'Copying',
  'rebuilding-fts': 'Rebuilding search index',
  'verifying-counts': 'Verifying row counts',
  'verifying-integrity': 'Checking integrity',
  'verifying-foreign-keys': 'Checking references',
  'verifying-spot-check': 'Spot-checking rows',
  finalizing: 'Finishing up',
};

/** Below this many rows copied we have no throughput sample worth trusting. */
const MIN_ROWS_FOR_ETA = 2_000;
/** Below this elapsed time the rate is dominated by startup cost. */
const MIN_MS_FOR_ETA = 4_000;

export interface MigrationSplashView {
  /** 0-100, monotonically non-decreasing across the whole migration. */
  percent: number;
  /** Left-hand meta line, e.g. "384,120 of 936,540 rows". */
  primary: string;
  /** Right-hand meta line: a coarse ETA, or '' when we cannot say. */
  eta: string;
  /** Phase line under the bar. */
  phase: string;
}

function coarseEta(msRemaining: number): string {
  if (msRemaining < 45_000) return 'under a minute';
  const minutes = Math.round(msRemaining / 60_000);
  if (minutes <= 1) return 'about a minute left';
  if (minutes < 10) return `about ${minutes} min left`;
  // Past ten minutes the estimate is not accurate enough to imply precision.
  return `${Math.round(minutes / 5) * 5}+ min left`;
}

export function buildSplashView(
  progress: MigrationProgress,
  previousPercent = 0,
): MigrationSplashView {
  const [start, end] = PHASE_BANDS[progress.phase] ?? [0, 100];
  const within = Math.min(Math.max(progress.percentOfTotal ?? 0, 0), 100) / 100;
  const raw = start + (end - start) * within;
  const percent = Math.min(100, Math.max(previousPercent, Math.round(raw)));

  const primary =
    progress.phase === 'copying' && progress.rowsExpected > 0
      ? `${progress.rowsCopied.toLocaleString()} of ${progress.rowsExpected.toLocaleString()} rows`
      : PHASE_LABELS[progress.phase] ?? 'Working';

  let eta = '';
  if (
    progress.phase === 'copying'
    && progress.rowsCopied >= MIN_ROWS_FOR_ETA
    && progress.elapsedMs >= MIN_MS_FOR_ETA
    && progress.rowsExpected > progress.rowsCopied
  ) {
    const rowsPerMs = progress.rowsCopied / progress.elapsedMs;
    if (rowsPerMs > 0) {
      const copyMsRemaining = (progress.rowsExpected - progress.rowsCopied) / rowsPerMs;
      // Copying is 78 of the 100 points on the bar, so the tail of
      // verification work is roughly a further 28% of the copy time.
      eta = coarseEta(copyMsRemaining * 1.28);
    }
  }

  const phase =
    progress.phase === 'copying' && progress.currentTable
      ? `Copying ${progress.currentTable}`
      : PHASE_LABELS[progress.phase] ?? '';

  return { percent, primary, eta, phase };
}
