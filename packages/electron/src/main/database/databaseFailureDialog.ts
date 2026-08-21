/**
 * Wording for the dialog shown when the database will not start.
 *
 * Pure and separate from `index.ts` for one reason: this text is safety-
 * critical and must be assertable. The previous version ended with
 *
 *     3. If the problem persists, delete the database folder:
 *        <path>
 *
 * Users followed it. Because the project list lives in electron-store rather
 * than in the database, the app then came back up looking healthy with every
 * session and all document history gone, so the instruction did not even look
 * like it had done damage (#1347).
 *
 * The invariant the tests hold: this dialog never tells anyone to delete their
 * data, and it only promises recoverable data when some actually exists.
 */

import type { RestorableBackup } from './sqlite/recoveryArtifacts';
import { formatBytes } from './sqlite/recoveryArtifacts';

export interface DatabaseFailureDialogContent {
  title: string;
  message: string;
  detail: string;
  buttons: string[];
  defaultId: number;
  cancelId: number;
  /**
   * Backup to reveal if the user picks the first button, or `null` when there
   * is nothing to show and the only button is Quit.
   */
  revealPath: string | null;
}

export function buildDatabaseFailureDialog(
  backups: RestorableBackup[],
): DatabaseFailureDialogContent {
  const hasBackups = backups.length > 0;

  const recovery = hasBackups
    ? `Your data has not been lost. These copies are on this computer right now:\n\n` +
      backups.map((b) => `   - ${b.name} (${formatBytes(b.bytes)})`).join('\n') +
      `\n\nDo not remove the database folder -- these backups are what it would be restored from.\n\n`
    : `Do not remove the database folder. Support can often recover a database that will not start.\n\n`;

  return {
    title: 'Nimbalyst - Database Initialization Failed',
    message: 'The database could not be started.',
    detail:
      recovery +
      `Things to try, in order:\n` +
      `1. Close any other Nimbalyst windows and open it again\n` +
      `2. Restart your computer, which clears stale database locks\n` +
      `3. If it still will not start, contact support before changing anything on disk\n\n` +
      `Nimbalyst will now close.`,
    buttons: hasBackups ? ['Show Backups', 'Quit'] : ['Quit'],
    defaultId: 0,
    cancelId: hasBackups ? 1 : 0,
    revealPath: hasBackups ? backups[0].path : null,
  };
}
