// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildDatabaseFailureDialog } from '../databaseFailureDialog';
import type { RestorableBackup } from '../sqlite/recoveryArtifacts';

const backup = (name: string, bytes: number): RestorableBackup => ({
  name,
  bytes,
  path: `/Users/someone/Library/Application Support/@nimbalyst/electron/db-backups/${name}`,
});

describe('buildDatabaseFailureDialog', () => {
  // The regression that cost users their history. The old dialog ended with
  // "delete the database folder: <path>", people followed it, and the app came
  // back up looking healthy with every session gone. This must never return.
  it('never instructs the user to remove their data', () => {
    for (const backups of [[], [backup('pglite-db.backup-current', 5_000_000)]]) {
      const { detail, message } = buildDatabaseFailureDialog(backups);
      const text = `${message}\n${detail}`.toLowerCase();
      for (const phrase of ['delete the database', 'remove the database folder:', 'rm -rf']) {
        expect(text).not.toContain(phrase);
      }
      expect(text).toContain('do not remove the database folder');
    }
  });

  it('names each recoverable copy with its size', () => {
    const { detail } = buildDatabaseFailureDialog([
      backup('pglite-db.backup-current', 274 * 1024 * 1024),
      backup('pglite-db.backup-2026-08-20T11-00-00-000Z', 1536 * 1024 * 1024),
    ]);
    expect(detail).toContain('pglite-db.backup-current (274 MB)');
    expect(detail).toContain('pglite-db.backup-2026-08-20T11-00-00-000Z (1.5 GB)');
    expect(detail).toContain('Your data has not been lost');
  });

  // Promising recoverable data that isn't there would be its own cruelty, and
  // a Show Backups button with nothing behind it is a dead end.
  it('promises nothing and offers only Quit when no backup exists', () => {
    const content = buildDatabaseFailureDialog([]);
    expect(content.detail).not.toContain('Your data has not been lost');
    expect(content.buttons).toEqual(['Quit']);
    expect(content.revealPath).toBeNull();
    expect(content.cancelId).toBe(0);
  });

  it('reveals the most promising backup behind the first button', () => {
    const best = backup('pglite-db.backup-current', 900);
    const content = buildDatabaseFailureDialog([best, backup('pglite-db.backup-previous', 800)]);
    expect(content.buttons[0]).toBe('Show Backups');
    expect(content.revealPath).toBe(best.path);
    // Escape must land on Quit, not on the action.
    expect(content.cancelId).toBe(1);
  });
});
