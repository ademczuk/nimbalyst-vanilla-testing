/**
 * Boot-time forced PGLite → SQLite migration, through a real Electron launch.
 *
 * `autoMigrate.test.ts` already proves the migration itself against a real
 * PGLite fixture. What only a launch can prove is the wiring: that
 * `initializeDatabase` actually reaches the trigger, that the migration runs
 * against the live PGLite worker, and that the app comes back up on SQLite.
 *
 * Shape of each spec: launch once to create a genuine PGLite store, close,
 * arrange the trigger conditions on disk, launch again and let the app migrate
 * itself, then assert the on-disk end state and that a third launch reads it.
 *
 * Note the app quits rather than relaunches under PLAYWRIGHT (see
 * `bootMigration.ts`) so the runner is never left holding an Electron process
 * it did not spawn.
 */

import { test, expect } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { launchElectronApp, createTempWorkspace, waitForAppReady } from '../helpers';

/**
 * Where `initializeDatabase` puts the store under Playwright. It ignores
 * NIMBALYST_USER_DATA_DIR and uses `app.getPath('temp')/nimbalyst-test-db`,
 * which is `os.tmpdir()` on every platform we run these on.
 */
const DB_ROOT = path.join(os.tmpdir(), 'nimbalyst-test-db');
const FLAG_FILE = path.join(DB_ROOT, 'database-backend.json');

function readFlag(): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(FLAG_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function migratedDirs(): string[] {
  try {
    return fs.readdirSync(DB_ROOT).filter((d) => d.startsWith('pglite-db.migrated-'));
  } catch {
    return [];
  }
}

/** Launch, wait for the window, then close. Leaves a populated store behind. */
async function launchOnPglite(workspace: string): Promise<void> {
  fs.mkdirSync(DB_ROOT, { recursive: true });
  // Pin to PGLite for this launch: `rollback` is the one state the selector
  // never treats as migration-due, so the app boots PGLite and builds a real
  // store without immediately migrating it.
  fs.writeFileSync(
    FLAG_FILE,
    JSON.stringify({ backend: 'pglite', setAt: new Date().toISOString(), setBy: 'rollback' }),
  );

  const app = await launchElectronApp({ workspace, preserveTestDatabase: true });
  const page = await app.firstWindow();
  await waitForAppReady(page);
  await app.close();
}

/** Make the next launch migration-due with the kill switch cached on. */
function armMigration(): void {
  fs.writeFileSync(
    FLAG_FILE,
    JSON.stringify({
      backend: 'pglite',
      setAt: new Date().toISOString(),
      setBy: 'auto-migration-deferred',
      forceMigrationFlag: true,
    }),
  );
}

test.describe('forced SQLite migration', () => {
  let workspace: string;
  let app: ElectronApplication | null = null;

  test.beforeEach(async () => {
    workspace = await createTempWorkspace();
    fs.rmSync(DB_ROOT, { recursive: true, force: true });
  });

  test.afterEach(async () => {
    await app?.close().catch(() => undefined);
    app = null;
  });

  test('a PGLite install migrates itself and comes back up on SQLite', async () => {
    await launchOnPglite(workspace);
    expect(fs.existsSync(path.join(DB_ROOT, 'pglite-db'))).toBe(true);

    armMigration();

    // This launch migrates and then quits itself, so don't wait for a window.
    const migrating = await launchElectronApp({ workspace, preserveTestDatabase: true });
    await migrating.waitForEvent('close', { timeout: 180_000 });

    expect(fs.existsSync(path.join(DB_ROOT, 'sqlite-db'))).toBe(true);
    expect(readFlag()).toMatchObject({ backend: 'sqlite', setBy: 'auto-migration' });
    // The pre-migration store is preserved so Settings → Database can roll back.
    expect(migratedDirs().length).toBe(1);

    // The claim that matters to a user: the next launch actually works.
    app = await launchElectronApp({ workspace, preserveTestDatabase: true });
    const page = await app.firstWindow();
    await waitForAppReady(page);
    expect(readFlag()).toMatchObject({ backend: 'sqlite' });
  });

  test('an install with no cached kill-switch value boots normally on PGLite', async () => {
    await launchOnPglite(workspace);

    // Migration-due, but we have never resolved the flag. The launch must not
    // migrate -- it should boot PGLite and leave the decision to next time.
    fs.writeFileSync(
      FLAG_FILE,
      JSON.stringify({
        backend: 'pglite',
        setAt: new Date().toISOString(),
        setBy: 'auto-migration-deferred',
      }),
    );

    app = await launchElectronApp({ workspace, preserveTestDatabase: true });
    const page = await app.firstWindow();
    await waitForAppReady(page);

    expect(readFlag()).toMatchObject({ backend: 'pglite' });
    expect(migratedDirs().length).toBe(0);
    expect(fs.existsSync(path.join(DB_ROOT, 'pglite-db'))).toBe(true);
  });
});
