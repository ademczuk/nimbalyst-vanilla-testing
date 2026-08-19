import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  commitFreshInstallSqlite,
  commitMigrationToSqlite,
  commitRollbackToPglite,
  readBackendState,
  resolveBackend,
} from '../BackendSelector';

describe('BackendSelector', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nim-backend-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('returns sqlite on a fresh install (no pglite-db, no flag)', () => {
    const result = resolveBackend({ userDataPath: tmp });
    expect(result.backend).toBe('sqlite');
    expect(result.reason).toBe('fresh-install-defaults-sqlite');
  });

  it('marks an existing pglite-db directory with no flag as migration-due', () => {
    fs.mkdirSync(path.join(tmp, 'pglite-db'));
    const result = resolveBackend({ userDataPath: tmp });
    expect(result.backend).toBe('pglite');
    expect(result.reason).toBe('existing-pglite-migration-due');
    expect(result.migrationDue).toBe(true);
  });

  it('obeys the flag file when present (sqlite)', () => {
    commitMigrationToSqlite(tmp, '/some/pglite-db.migrated-12345');
    const result = resolveBackend({ userDataPath: tmp });
    expect(result.backend).toBe('sqlite');
    expect(result.reason).toBe('flag-file-sqlite');
    expect(result.state?.pgliteMigratedDir).toBe('/some/pglite-db.migrated-12345');
  });

  it('never re-migrates an install that rolled back to pglite', () => {
    fs.mkdirSync(path.join(tmp, 'pglite-db'));
    commitRollbackToPglite(tmp);
    const result = resolveBackend({ userDataPath: tmp });
    expect(result.backend).toBe('pglite');
    expect(result.reason).toBe('flag-file-pglite-rollback');
    expect(result.state?.setBy).toBe('rollback');
    // The whole point: they told us SQLite went badly. Auto-migration must
    // not drag them back onto it.
    expect(result.migrationDue).toBe(false);
  });

  it('records the fresh-install marker on commitFreshInstallSqlite', () => {
    commitFreshInstallSqlite(tmp);
    const state = readBackendState(tmp);
    expect(state?.backend).toBe('sqlite');
    expect(state?.setBy).toBe('auto-fresh-install');
  });

  it('ignores a malformed flag file and falls back to inferring from disk', () => {
    fs.writeFileSync(path.join(tmp, 'database-backend.json'), '{not json');
    const result = resolveBackend({ userDataPath: tmp });
    expect(result.backend).toBe('sqlite'); // no pglite-db -> fresh install
  });
});
