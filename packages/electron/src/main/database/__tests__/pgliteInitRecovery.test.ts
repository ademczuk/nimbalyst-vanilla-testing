// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { planInitFailureResponse } from '../pgliteInitRecovery';

/**
 * The values worker.js runs with. `dataDirPredatesLaunch: false` is the
 * this-launch-created-it case, which is the only one an auto-rename can touch.
 */
const defaults = {
  maxAttempts: 3,
  renameAllowedFromAttempt: 2,
  dataDirExists: true,
  dataDirPredatesLaunch: false,
};

const plan = (over: Partial<Parameters<typeof planInitFailureResponse>[0]>) =>
  planInitFailureResponse({
    errorMessage: 'Aborted(). Build with -sASSERTIONS for more info.',
    errorName: 'RuntimeError',
    attempt: 1,
    ...defaults,
    ...over,
  });

describe('planInitFailureResponse', () => {
  // The regression. A single WASM abort used to rename the database aside,
  // and the app came up healthy-looking with no sessions and no history.
  it('retries the same directory on a first abort instead of renaming', () => {
    expect(plan({ attempt: 1 })).toEqual({
      action: 'retry',
      reason: 'first-abort-may-be-transient',
    });
  });

  it('renames only once the same directory has aborted twice', () => {
    expect(plan({ attempt: 2 }).action).toBe('rename');
  });

  // The rest of #1347. Retrying first narrowed the window but did not close
  // it: two aborts in a row still bought the right to move an established
  // user's only copy of their data, on nothing but a WASM error name. A
  // directory that existed before this launch is the user's, and setting it
  // aside is their call to make -- so we fail up to the recovery dialog, which
  // lists the backups we hold, instead of acting on our own.
  it('refuses to auto-rename a database that existed before this launch', () => {
    for (const attempt of [2, 3]) {
      expect(plan({ attempt, dataDirPredatesLaunch: true })).toEqual({
        action: 'rethrow',
        reason: 'preexisting-data-needs-consent',
      });
    }
  });

  it('still renames a directory this launch created, where nothing can be lost', () => {
    expect(plan({ attempt: 2, dataDirPredatesLaunch: false })).toEqual({
      action: 'rename',
      reason: 'repeated-aborts-on-directory-we-created',
    });
  });

  // Consent outranks the attempt budget: exhausting attempts must not become a
  // back door to renaming what we just refused to rename.
  it('never returns rename for pre-existing data under any configuration', () => {
    for (const attempt of [1, 2, 3, 4]) {
      for (const maxAttempts of [2, 3, 4, 5]) {
        expect(plan({ attempt, maxAttempts, dataDirPredatesLaunch: true }).action)
          .not.toBe('rename');
      }
    }
  });

  it('gives up rather than looping once attempts are exhausted', () => {
    expect(plan({ attempt: 3 })).toEqual({ action: 'rethrow', reason: 'attempts-exhausted' });
  });

  // A lock or a permissions failure is not corruption, and renaming the
  // database aside would destroy data over a problem that resolves itself.
  it('never touches the database for a non-abort failure', () => {
    for (const attempt of [1, 2, 3]) {
      expect(
        plan({ attempt, errorMessage: 'database is locked', errorName: 'Error' }),
      ).toEqual({ action: 'rethrow', reason: 'not-an-abort' });
    }
  });

  it('treats a bare Aborted message as an abort even without RuntimeError', () => {
    expect(plan({ attempt: 2, errorMessage: 'Aborted(native code)', errorName: 'Error' }).action)
      .toBe('rename');
  });

  it('does not try to rename a directory that is not there', () => {
    expect(plan({ attempt: 2, dataDirExists: false })).toEqual({
      action: 'rethrow',
      reason: 'no-data-dir-to-move',
    });
  });

  // Guards the boundary itself: with the old maxAttempts=2 the first abort
  // landed straight on 'rename'. That configuration must not come back.
  it('never renames on the first attempt for any sane configuration', () => {
    for (const maxAttempts of [2, 3, 4, 5]) {
      expect(plan({ attempt: 1, maxAttempts }).action).not.toBe('rename');
    }
  });
});
