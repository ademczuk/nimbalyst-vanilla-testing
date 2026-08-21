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
 */

/**
 * @param {object} input
 * @param {string} input.errorMessage
 * @param {string} input.errorName
 * @param {number} input.attempt 1-based attempt that just failed
 * @param {number} input.maxAttempts
 * @param {number} input.renameAllowedFromAttempt earliest attempt that may rename
 * @param {boolean} input.dataDirExists
 */
export function planInitFailureResponse(input) {
  const {
    errorMessage,
    errorName,
    attempt,
    maxAttempts,
    renameAllowedFromAttempt,
    dataDirExists,
  } = input;

  const isAbort = String(errorMessage ?? '').includes('Aborted') || errorName === 'RuntimeError';

  if (!isAbort) {
    return { action: 'rethrow', reason: 'not-an-abort' };
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
  return { action: 'rename', reason: 'repeated-aborts-on-same-directory' };
}
