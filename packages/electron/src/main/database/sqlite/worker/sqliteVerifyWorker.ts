/**
 * SQLite backup verification worker.
 *
 * Runs one `verifyBackupFile` against one file, posts the result, and exits.
 * It exists purely so that synchronous scan does not happen on the thread that
 * serves `query` requests — see backupVerification.ts for the incident that
 * motivated it.
 */

import { parentPort, workerData } from 'worker_threads';
import { verifyBackupFile } from '../backupVerification';

if (!parentPort) {
  throw new Error('sqliteVerifyWorker must run as a worker_threads Worker');
}

const { backupPath } = (workerData ?? {}) as { backupPath?: string };
if (!backupPath) {
  parentPort.postMessage({ valid: false, error: 'sqliteVerifyWorker requires a backupPath' });
} else {
  parentPort.postMessage(verifyBackupFile(backupPath));
}
