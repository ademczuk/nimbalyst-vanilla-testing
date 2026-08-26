/**
 * Backup verification — structural check of a backup file, run off the
 * query-serving thread.
 *
 * Why this is its own module and its own worker: verification opens a
 * read-only handle to a file on disk and needs nothing from the live
 * connection, but better-sqlite3 is synchronous, so running it inside the
 * SQLite worker blocks that thread's event loop outright. It doesn't just
 * slow queries down — queued `query` messages are never dequeued. On a
 * 6.3 GB database a startup backup blocked the worker for ~66 seconds and
 * every one of the 221 requests queued behind it hit the proxy's 60s
 * request timeout.
 *
 * Two changes address that:
 *   1. `verifyBackupOffThread` runs `verifyBackupFile` in a short-lived
 *      worker thread, so the query-serving worker keeps draining its queue.
 *   2. The check itself is `PRAGMA quick_check` rather than
 *      `integrity_check`. quick_check catches malformed/out-of-order records
 *      — the damage a bad copy actually produces — while skipping the
 *      index-vs-table cross-validation that dominates integrity_check's cost.
 *      The source of these files is SQLite's own Online Backup API, so index
 *      consistency follows from the pages copying cleanly.
 */

import { Worker } from 'worker_threads';
import * as fs from 'fs';
import * as path from 'path';
import { loadBetterSqlite, nativeBindingOverride } from './betterSqliteLoader';

export interface BackupVerificationResult {
  valid: boolean;
  error?: string;
  hasData?: boolean;
  sessionCount?: number;
  historyCount?: number;
}

export type BackupVerifier = (backupPath: string) => Promise<BackupVerificationResult>;

/** Filename of the verification worker bundle, sibling of the caller's bundle. */
export const VERIFY_WORKER_FILENAME = 'sqlite-verify-worker.bundle.js';

/**
 * Synchronous verification. Blocks the calling thread for as long as it takes
 * to read the file, so only call this on a thread that has nothing else to do
 * — see `verifyBackupOffThread`.
 */
export function verifyBackupFile(backupPath: string): BackupVerificationResult {
  try {
    const Sqlite = loadBetterSqlite();
    const nativeBinding = nativeBindingOverride();
    const handle = new Sqlite(
      backupPath,
      nativeBinding
        ? { fileMustExist: true, readonly: true, nativeBinding }
        : { fileMustExist: true, readonly: true },
    );
    try {
      const check = (handle.pragma('quick_check', { simple: true }) as string) ?? '';
      if (check !== 'ok') {
        return { valid: false, error: `quick_check returned: ${check}` };
      }
      const sessionCount = (handle.prepare('SELECT COUNT(*) AS c FROM ai_sessions').get() as
        | { c: number }
        | undefined)?.c ?? 0;
      const historyCount = (handle.prepare('SELECT COUNT(*) AS c FROM document_history').get() as
        | { c: number }
        | undefined)?.c ?? 0;
      return {
        valid: true,
        hasData: sessionCount > 0 || historyCount > 0,
        sessionCount,
        historyCount,
      };
    } finally {
      handle.close();
    }
  } catch (err) {
    return { valid: false, error: (err as Error).message };
  }
}

/**
 * Verify on a dedicated worker thread so the caller's thread stays responsive.
 *
 * `workerDir` is the directory holding the verification bundle — in practice
 * `path.dirname(__filename)` of whichever worker bundle is asking, since the
 * bundles are shipped side by side (`out/` in dev, `Resources/` when packaged).
 *
 * Falls back to inline verification when the bundle is missing or the thread
 * can't be spawned. That reintroduces the blocking, but a packaging miss must
 * degrade to today's behaviour rather than skip a data-safety gate.
 */
export function verifyBackupOffThread(
  backupPath: string,
  workerDir: string,
  log?: (level: 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void,
): Promise<BackupVerificationResult> {
  const workerPath = path.join(workerDir, VERIFY_WORKER_FILENAME);
  if (!fs.existsSync(workerPath)) {
    log?.('warn', '[SQLite Backup] Verification worker bundle missing; verifying inline', {
      workerPath,
    });
    return Promise.resolve(verifyBackupFile(backupPath));
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: BackupVerificationResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let worker: Worker;
    try {
      worker = new Worker(workerPath, { workerData: { backupPath } });
    } catch (err) {
      log?.('warn', '[SQLite Backup] Could not spawn verification worker; verifying inline', err);
      finish(verifyBackupFile(backupPath));
      return;
    }

    worker.on('message', (result: BackupVerificationResult) => {
      finish(result);
      void worker.terminate();
    });
    worker.on('error', (err) => {
      log?.('warn', '[SQLite Backup] Verification worker errored; verifying inline', err);
      finish(verifyBackupFile(backupPath));
    });
    worker.on('exit', (code) => {
      finish({ valid: false, error: `verification worker exited (code ${code}) without a result` });
    });
  });
}
