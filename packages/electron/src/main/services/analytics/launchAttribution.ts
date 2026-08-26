/**
 * Launch attribution buckets for `nimbalyst_session_start`.
 *
 * Separate from `AnalyticsService` because that module constructs its singleton
 * at import time (which boots an electron-store), and these are pure functions
 * that anything — including a test — should be able to read cheaply.
 *
 * Both are bucketed rather than raw. A precise install timestamp plus a precise
 * launch count is close to a unique key on a small cohort, and neither question
 * we are asking needs the precision.
 */

export type BuildType = 'official' | 'dev' | 'local';

export function bucketDaysSinceInstall(days: number): string {
  if (days <= 0) return '0';
  if (days === 1) return '1';
  if (days <= 7) return '2-7';
  if (days <= 30) return '8-30';
  if (days <= 90) return '31-90';
  return '90+';
}

/**
 * Launch two is its own bucket on purpose: "launched once and never came back"
 * is the sharpest cut in the activation funnel, and it disappears if launches
 * two and three are pooled.
 */
export function bucketLaunchNumber(launch: number): string {
  if (launch <= 1) return '1';
  if (launch === 2) return '2';
  if (launch <= 5) return '3-5';
  if (launch <= 20) return '6-20';
  return '20+';
}

export interface LaunchState {
  firstLaunchAt?: string;
  launchCount?: number;
}

export interface LaunchDecision {
  /** What to persist back. */
  next: Required<LaunchState>;
  launchNumber: number;
  daysSinceInstall: number;
}

/**
 * Decide this launch's attribution from the persisted state, as a pure
 * function of (stored state, now).
 *
 * Pure on purpose: the interesting behavior only appears on the SECOND launch,
 * and a decision that can only be exercised by starting a real app twice is a
 * decision nobody ever tests. Keeping it out of the service means the
 * two-boot case is an ordinary unit test.
 */
export function decideLaunch(stored: LaunchState, nowMs: number): LaunchDecision {
  const firstLaunchAt = stored.firstLaunchAt ?? new Date(nowMs).toISOString();
  const launchNumber = (stored.launchCount ?? 0) + 1;

  const installedAtMs = Date.parse(firstLaunchAt);
  // A corrupt or unparseable stored date must not produce NaN days, which
  // would serialize as `null` and quietly create an unbucketed value.
  const daysSinceInstall = Number.isNaN(installedAtMs)
    ? 0
    : Math.max(0, Math.floor((nowMs - installedAtMs) / 86_400_000));

  return {
    next: { firstLaunchAt, launchCount: launchNumber },
    launchNumber,
    daysSinceInstall,
  };
}
