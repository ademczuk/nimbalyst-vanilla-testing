// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SQLiteDatabase } from '../SQLiteDatabase';
import { verifyBackupFile, verifyBackupOffThread } from '../backupVerification';

const SCHEMA_DIR = path.resolve(__dirname, '..', 'schemas');

describe('backupVerification', () => {
  let tmp: string;
  let dbPath: string;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nim-verify-'));
    const dbDir = path.join(tmp, 'sqlite-db');
    const sqlite = new SQLiteDatabase({ dbDir, schemaDir: SCHEMA_DIR });
    await sqlite.initialize();
    sqlite.getRawHandle()!
      .prepare('INSERT INTO ai_sessions(id, provider) VALUES (?, ?)')
      .run('s1', 'claude');
    dbPath = path.join(tmp, 'backup.sqlite');
    await sqlite.getRawHandle()!.backup(dbPath);
    await sqlite.close();
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('accepts a sound backup and reports its row counts', () => {
    const result = verifyBackupFile(dbPath);
    expect(result).toMatchObject({ valid: true, hasData: true, sessionCount: 1 });
  });

  it('rejects a file whose pages are damaged', () => {
    // quick_check replaced integrity_check here for cost; it still has to
    // catch the damage a bad copy actually produces. Corrupt a page well past
    // the header so the file still opens and the failure comes from the check
    // rather than from SQLite refusing the file outright.
    const fd = fs.openSync(dbPath, 'r+');
    fs.writeSync(fd, Buffer.alloc(2048, 0xff), 0, 2048, 4096);
    fs.closeSync(fd);

    expect(verifyBackupFile(dbPath).valid).toBe(false);
  });

  it('rejects a backup file that is not there', () => {
    const result = verifyBackupFile(path.join(tmp, 'missing.sqlite'));
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('falls back to inline verification when the worker bundle is absent', async () => {
    // A packaging miss must degrade to blocking-but-correct, never to skipping
    // the gate. `tmp` deliberately holds no verify bundle.
    await expect(verifyBackupOffThread(dbPath, tmp)).resolves.toMatchObject({ valid: true });
  });
});
