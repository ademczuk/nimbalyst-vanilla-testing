## Never Destroy User Data on a Heuristic

A code path that **renames, moves, truncates, overwrites, or deletes** the user's data is a destructive path, whatever the surrounding function is called. Sessions and document history exist in exactly one place on one disk — there is no server-side copy to fall back on. Collab covers shared documents and trackers; it does not cover this.

This rule exists because of GitHub #1347. A feature named "database backup and corruption recovery system" renamed the live `pglite-db/` aside whenever PGLite init threw an error whose message contained `Aborted` or whose `name` was `RuntimeError` — any WASM abort, including OOM and transient lock collisions. No retry, no verification, no consent, no event. It ran for nine months. Six established installs (30–349 sessions each) were confirmed running on empty databases; three then migrated the empty database to SQLite and made it permanent. The intent in the feature name is what got it through review; nobody read the trigger condition.

### Requirements for any destructive path

1. **Retry before you destroy.** A single failure is evidence that something went wrong once, not that the data is bad.
2. **Verify the damage is real.** An `integrity_check`, a size check, a parse — not a substring match on an error message. If you cannot verify, you may not destroy.
3. **Emit the event before you act, not after.** In #1347 the recovery event was only computed if the *same process* finished init, so a mid-recovery death reported nothing. Nine months of loss were invisible.
4. **Ask, unless the app genuinely cannot start.** Automatic destruction needs a reason stronger than convenience.
5. **Leave a recoverable artifact, and give it a launch heartbeat on day one.** We had a heartbeat for `pglite-db.migrated-*` (the *success* artifact) and none for `pglite-db.backup-*` (the *loss* artifact). One line would have dated the bug to November.

### Never instruct the user to delete their data

The #1347 failure dialog's step 3 read "delete the database folder: …" and then quit. It never mentioned the three rolling backups sitting one directory over, or that `restoreFromBackup()` already existed and was already wired to other recovery paths. 64 distinct users saw that dialog in 30 days.

Restore-from-backup is the **primary** action. A destructive option is secondary, names exactly what will be lost, and is only offered after a backup has been taken.

### Extract the decision from the environment

The rename branch could only fire on a real WASM abort inside a real PGLite, so the most dangerous branch in the database layer had never once executed under observation. **If a destructive decision can only be triggered by an environment you cannot reproduce, the decision is in the wrong place.** Move it to a pure function that takes the facts and returns the plan, and test the plan. `packages/electron/src/main/database/pgliteInitRecovery.js` is the pattern.

### Two test cases you are probably not writing

- **Second launch.** Anything that persists a decision at first boot must be tested across two boots. `commitFreshInstallSqlite` was defined, unit-tested, and never called — a green test on a function with zero callers, certifying the wrong thing. The bug only appeared on launch two.
- **Production scale.** A synchronous operation on the database file must be sized against a realistic file. `PRAGMA integrity_check` over a 6.3 GB database blocked the query worker for 66 seconds and killed 221 queued requests; it is instant on a fixture.

### Verification never trusts the source it is verifying

Every gate on the PGLite→SQLite migration compared the target against the source and passed trivially when the source was empty. A check that answers "did we copy faithfully?" does not answer "was the source plausibly the user's data?" A destructive or one-way operation needs at least one signal from **outside** the thing it is operating on.
