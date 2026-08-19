// @vitest-environment node
/**
 * Boot-time forced migration.
 *
 * The user-visible claim under test is "an install still on PGLite launches,
 * migrates without being asked, and comes up on SQLite with its data intact".
 * The first case proves that end to end against a real PGLite fixture and the
 * real orchestrator: after `maybeAutoMigrate` returns, `resolveBackend` must
 * independently agree that SQLite is now the backend, and the rows must be
 * readable from the SQLite file.
 *
 * The remaining cases drive the decision tree (flag gate, back-off, failure
 * fallback) through a stub orchestrator, because they are about *whether* the
 * migration runs, not about the copy itself. `PGLiteToSQLiteMigrator.test.ts`
 * and `MigrationOrchestrator.fixtureRoundtrip.test.ts` already own copy
 * correctness; this file must not re-prove it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { maybeAutoMigrate, type OrchestratorLike } from '../autoMigrate';
import { readBackendState, resolveBackend, writeBackendState } from '../BackendSelector';
import { MigrationOrchestrator, type LivePgliteReader } from '../MigrationOrchestrator';
import type { PGLiteHandle } from '../PGLiteToSQLiteMigrator';
import { SQLiteDatabase } from '../SQLiteDatabase';

const SCHEMA_DIR = path.resolve(__dirname, '..', 'schemas');

let tmp: string;
let pgliteDir: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nim-auto-migrate-'));
  pgliteDir = path.join(tmp, 'pglite-db');
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/**
 * Minimal PGLite source. Deliberately two tables and a handful of rows: this
 * file proves the *trigger*, not the copy, so a big fixture would only buy
 * runtime.
 */
async function seedPglite(): Promise<void> {
  fs.mkdirSync(pgliteDir, { recursive: true });
  const db = new PGlite({ dataDir: pgliteDir });
  await (db as unknown as { waitReady: Promise<void> }).waitReady;
  await db.exec(`
    CREATE TABLE ai_sessions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL DEFAULT 'default',
      provider TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT 'New conversation',
      metadata JSONB NOT NULL DEFAULT '{}',
      is_archived BOOLEAN NOT NULL DEFAULT FALSE,
      is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    INSERT INTO ai_sessions (id, provider, title) VALUES
      ('s1', 'claude-code', 'Survives the migration'),
      ('s2', 'claude-code', 'So does this one');
  `);
  await db.close();
}

function realOrchestrator(): OrchestratorLike {
  let live: PGlite | null = null;
  const reader: LivePgliteReader = {
    queryReadOnly: async <T,>(sql: string, params?: unknown[]) => {
      if (!live) {
        live = new PGlite({ dataDir: pgliteDir });
        await (live as unknown as { waitReady: Promise<void> }).waitReady;
      }
      return live.query<T>(sql, params) as Promise<{ rows: T[] }>;
    },
  };
  return new MigrationOrchestrator({
    userDataPath: tmp,
    schemaDir: SCHEMA_DIR,
    pglite: reader,
    closeRunningPglite: async () => {
      await live?.close();
      live = null;
    },
    reopenPgliteAfterClose: async (dataDir: string): Promise<PGLiteHandle> => {
      const db = new PGlite({ dataDir });
      await (db as unknown as { waitReady: Promise<void> }).waitReady;
      return {
        query: <T,>(sql: string, params?: unknown[]) =>
          db.query<T>(sql, params as unknown[]) as Promise<{ rows: T[] }>,
        exec: (sql: string) => db.exec(sql),
        close: () => db.close(),
      };
    },
  });
}

/** Stub for the decision-tree cases. `run` resolves or rejects on command. */
function stubOrchestrator(behavior: 'ok' | 'preflight-fail' | 'run-fail'): OrchestratorLike & {
  runCalls: number;
} {
  const stub = {
    runCalls: 0,
    async preflight() {
      return behavior === 'preflight-fail'
        ? { ok: false, reason: 'Not enough free disk space.', pgliteDirBytes: 10, freeBytes: 1, requiredBytes: 20 }
        : { ok: true, pgliteDirBytes: 10, freeBytes: 100, requiredBytes: 20 };
    },
    async run() {
      stub.runCalls += 1;
      if (behavior === 'run-fail') throw new Error('copy exploded');
      return { tablesMigrated: 1, targetRowCount: 2, durationMs: 5 } as never;
    },
  };
  return stub;
}

describe('maybeAutoMigrate', () => {
  it('migrates a PGLite install to SQLite and leaves the backend resolving to sqlite', async () => {
    await seedPglite();
    const relaunch = vi.fn();

    const outcome = await maybeAutoMigrate({
      userDataPath: tmp,
      resolved: resolveBackend({ userDataPath: tmp }),
      isFlagEnabled: () => true,
      orchestrator: realOrchestrator(),
      relaunch,
    });

    expect(outcome.action).toBe('migrated');
    expect(relaunch).toHaveBeenCalledTimes(1);

    // The claim that matters: an independent re-resolution now says sqlite.
    expect(resolveBackend({ userDataPath: tmp }).backend).toBe('sqlite');
    expect(readBackendState(tmp)?.setBy).toBe('auto-migration');

    // Data survived, and the pre-migration store was preserved for rollback.
    const sqlite = new SQLiteDatabase({ dbDir: path.join(tmp, 'sqlite-db'), schemaDir: SCHEMA_DIR });
    await sqlite.initialize();
    const rows = await sqlite.query<{ id: string }>('SELECT id FROM ai_sessions ORDER BY id');
    expect(rows.rows.map((r) => r.id)).toEqual(['s1', 's2']);
    await sqlite.close();

    expect(fs.readdirSync(tmp).some((d) => d.startsWith('pglite-db.migrated-'))).toBe(true);
  }, 60_000);

  it('does not migrate on the launch that first learns the flag value', async () => {
    await seedPglite();
    const orchestrator = stubOrchestrator('ok');

    const outcome = await maybeAutoMigrate({
      userDataPath: tmp,
      resolved: resolveBackend({ userDataPath: tmp }),
      isFlagEnabled: () => null, // nothing cached yet
      orchestrator,
      relaunch: vi.fn(),
    });

    expect(outcome).toEqual({ action: 'skipped', reason: 'flag-unknown' });
    expect(orchestrator.runCalls).toBe(0);
    expect(resolveBackend({ userDataPath: tmp }).backend).toBe('pglite');
  });

  it('does not migrate when the flag is off', async () => {
    await seedPglite();
    const orchestrator = stubOrchestrator('ok');

    const outcome = await maybeAutoMigrate({
      userDataPath: tmp,
      resolved: resolveBackend({ userDataPath: tmp }),
      isFlagEnabled: () => false,
      orchestrator,
      relaunch: vi.fn(),
    });

    expect(outcome).toEqual({ action: 'skipped', reason: 'flag-disabled' });
    expect(orchestrator.runCalls).toBe(0);
  });

  it('leaves the user on PGLite and records the attempt when the migration fails', async () => {
    await seedPglite();
    const relaunch = vi.fn();

    const outcome = await maybeAutoMigrate({
      userDataPath: tmp,
      resolved: resolveBackend({ userDataPath: tmp }),
      isFlagEnabled: () => true,
      orchestrator: stubOrchestrator('run-fail'),
      relaunch,
    });

    expect(outcome.action).toBe('failed');
    expect(relaunch).not.toHaveBeenCalled();
    expect(resolveBackend({ userDataPath: tmp }).backend).toBe('pglite');
    expect(readBackendState(tmp)?.migrationAttempts?.count).toBe(1);
  });

  it('stops auto-attempting after three consecutive failures', async () => {
    await seedPglite();
    writeBackendState(tmp, {
      backend: 'pglite',
      setAt: new Date().toISOString(),
      setBy: 'auto-migration-deferred',
      migrationAttempts: { count: 3, lastAttemptAt: new Date().toISOString(), lastErrorCode: 'unknown' },
    });
    const orchestrator = stubOrchestrator('ok');

    const outcome = await maybeAutoMigrate({
      userDataPath: tmp,
      resolved: resolveBackend({ userDataPath: tmp }),
      isFlagEnabled: () => true,
      orchestrator,
      relaunch: vi.fn(),
    });

    expect(outcome).toEqual({ action: 'skipped', reason: 'backed-off' });
    expect(orchestrator.runCalls).toBe(0);
  });

  it('skips an install that is already on SQLite', async () => {
    fs.mkdirSync(path.join(tmp, 'sqlite-db'), { recursive: true });
    const orchestrator = stubOrchestrator('ok');

    const outcome = await maybeAutoMigrate({
      userDataPath: tmp,
      resolved: resolveBackend({ userDataPath: tmp }),
      isFlagEnabled: () => true,
      orchestrator,
      relaunch: vi.fn(),
    });

    expect(outcome).toEqual({ action: 'skipped', reason: 'not-due' });
    expect(orchestrator.runCalls).toBe(0);
  });

  it('boots normally when pre-flight fails, without recording a migration failure', async () => {
    await seedPglite();
    const orchestrator = stubOrchestrator('preflight-fail');

    const outcome = await maybeAutoMigrate({
      userDataPath: tmp,
      resolved: resolveBackend({ userDataPath: tmp }),
      isFlagEnabled: () => true,
      orchestrator,
      relaunch: vi.fn(),
    });

    expect(outcome).toMatchObject({ action: 'skipped', reason: 'preflight-failed' });
    expect(orchestrator.runCalls).toBe(0);
    // Pre-flight is an environment problem (disk space), not a broken
    // migration -- it must not burn one of the three attempts.
    expect(readBackendState(tmp)?.migrationAttempts).toBeUndefined();
  });
});
