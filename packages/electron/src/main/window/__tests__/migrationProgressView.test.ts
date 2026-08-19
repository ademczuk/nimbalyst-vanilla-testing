// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { buildSplashView } from '../migrationProgressView';
import type { MigrationProgress, MigrationPhase } from '../../database/sqlite/PGLiteToSQLiteMigrator';

function progress(over: Partial<MigrationProgress> & { phase: MigrationPhase }): MigrationProgress {
  return {
    rowsCopied: 0,
    rowsExpected: 0,
    tableRowsCopied: 0,
    tableRowsExpected: 0,
    tablesCompleted: 0,
    tablesTotal: 1,
    percentOfTotal: 0,
    elapsedMs: 0,
    ...over,
  };
}

describe('buildSplashView', () => {
  it('never moves the bar backwards when a phase restarts its own percentage', () => {
    // The migrator reports percentOfTotal per phase, so every phase boundary
    // looks like a reset. A user watching a 10-minute migration must not see
    // the bar jump back to zero seven times.
    const phases: MigrationPhase[] = [
      'preparing',
      'copying',
      'rebuilding-fts',
      'verifying-counts',
      'verifying-integrity',
      'verifying-foreign-keys',
      'verifying-spot-check',
      'finalizing',
    ];
    let last = 0;
    for (const phase of phases) {
      for (const percentOfTotal of [0, 50, 100]) {
        const view = buildSplashView(progress({ phase, percentOfTotal }), last);
        expect(view.percent).toBeGreaterThanOrEqual(last);
        last = view.percent;
      }
    }
    expect(last).toBe(100);
  });

  it('withholds the ETA until there is a throughput sample worth trusting', () => {
    const tooEarly = buildSplashView(progress({
      phase: 'copying',
      rowsCopied: 12,
      rowsExpected: 900_000,
      elapsedMs: 300,
      percentOfTotal: 0,
    }));
    expect(tooEarly.eta).toBe('');

    const settled = buildSplashView(progress({
      phase: 'copying',
      rowsCopied: 100_000,
      rowsExpected: 900_000,
      elapsedMs: 60_000,
      percentOfTotal: 11,
    }));
    // 100k rows in 60s -> 800k remaining is ~8min of copying, plus the
    // verification tail. Coarse by design, so assert the shape not the number.
    expect(settled.eta).toMatch(/min left$/);
  });

  it('reports row counts while copying and the phase name otherwise', () => {
    expect(buildSplashView(progress({
      phase: 'copying',
      rowsCopied: 384_120,
      rowsExpected: 936_540,
      currentTable: 'ai_agent_messages',
      percentOfTotal: 41,
    }))).toMatchObject({
      primary: '384,120 of 936,540 rows',
      phase: 'Copying ai_agent_messages',
    });

    expect(buildSplashView(progress({ phase: 'verifying-integrity', percentOfTotal: 50 })))
      .toMatchObject({ primary: 'Checking integrity', eta: '' });
  });
});
