/**
 * What to do when PGLite fails to initialize.
 *
 * Split out of `worker.js` so the decision is testable without standing up a
 * real PGLite. The rule this encodes is the whole point:
 *
 *   A `RuntimeError` is *any* WASM abort -- memory pressure, a bad allocation,
 *   an interrupted load. It is not proof the database on disk is damaged.
 *
 * Treating the first one as proof was destructive: the worker renamed the
 * database aside on a single stumble, and the app came back up looking healthy
 * because the project list lives in electron-store rather than in the database.
 * Established installs lost every session and all document history and did not
 * notice for hours (#1347).
 *
 * So a first abort retries the same directory, and only a repeat renames.
 *
 * Retrying narrowed that window but did not close it: two aborts in a row
 * still bought the right to move an established user's only copy of their
 * data, on nothing but a WASM error name. There is nothing we can read from
 * here that distinguishes a corrupt database from a stumble, so we stopped
 * trying to guess and drew the line at ownership instead:
 *
 *   A directory that existed before this launch is the user's. Setting it
 *   aside is their call. A directory this launch created holds nothing that
 *   can be lost, so recovering it automatically is free.
 *
 * When we refuse, the abort propagates to `index.ts`, which shows the recovery
 * dialog -- the one that lists the backups we hold and can reveal them. The
 * user gets a database that will not start and an honest account of what
 * exists, instead of a database that starts empty and looks fine.
 */

/**
 * @param {object} input
 * @param {string} input.errorMessage
 * @param {string} input.errorName
 * @param {number} input.attempt 1-based attempt that just failed
 * @param {number} input.maxAttempts
 * @param {number} input.renameAllowedFromAttempt earliest attempt that may rename
 * @param {boolean} input.dataDirExists
 * @param {boolean} input.dataDirPredatesLaunch true when the directory was on
 *   disk before this process started -- i.e. it holds the user's data, not
 *   ours. Never auto-renamed.
 */
export function planInitFailureResponse(input) {
  const {
    errorMessage,
    errorName,
    attempt,
    maxAttempts,
    renameAllowedFromAttempt,
    dataDirExists,
    dataDirPredatesLaunch,
  } = input;

  const isAbort = String(errorMessage ?? '').includes('Aborted') || errorName === 'RuntimeError';

  if (!isAbort) {
    return { action: 'rethrow', reason: 'not-an-abort' };
  }
  // Checked before the attempt budget so that running out of attempts can
  // never become a back door to the rename we just refused.
  if (dataDirPredatesLaunch && attempt >= renameAllowedFromAttempt) {
    return { action: 'rethrow', reason: 'preexisting-data-needs-consent' };
  }
  if (attempt >= maxAttempts) {
    return { action: 'rethrow', reason: 'attempts-exhausted' };
  }
  if (attempt < renameAllowedFromAttempt) {
    return { action: 'retry', reason: 'first-abort-may-be-transient' };
  }
  if (!dataDirExists) {
    return { action: 'rethrow', reason: 'no-data-dir-to-move' };
  }
  return { action: 'rename', reason: 'repeated-aborts-on-directory-we-created' };
}
