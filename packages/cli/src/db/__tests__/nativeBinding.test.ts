/**
 * The bundled channel's contract: load the app's own binding, or say exactly
 * what was missing. A silent fallback to another better-sqlite3 on the machine
 * would not throw here -- on a Node-API 9 host it would segfault the process --
 * so "it failed with a message naming the path" is the behaviour under test,
 * not an incidental detail of it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { openDatabase } from '../openDatabase.js';
import { resetSqliteChannel, useBundledSqlite } from '../nativeBinding.js';

const require = createRequire(import.meta.url);
const realBetterSqlite = path.dirname(require.resolve('better-sqlite3/package.json'));

const scratchDirs: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'nim-cli-binding-'));
  scratchDirs.push(dir);
  return dir;
}

/** A Resources dir whose better-sqlite3 is the real, loadable installation. */
function resourcesWithRealBinding(): string {
  const resources = scratch();
  mkdirSync(path.join(resources, 'node_modules'), { recursive: true });
  // Symlink rather than copy: the prebuilds are ~16 MB and require() resolves
  // through the link to the same package either way.
  symlinkSync(realBetterSqlite, path.join(resources, 'node_modules', 'better-sqlite3'), 'dir');
  return resources;
}

/** A Resources dir whose better-sqlite3 has no prebuild this host can load. */
function resourcesWithNoUsablePrebuild(): string {
  const resources = scratch();
  const pkg = path.join(resources, 'node_modules', 'better-sqlite3');
  mkdirSync(pkg, { recursive: true });
  cpSync(path.join(realBetterSqlite, 'package.json'), path.join(pkg, 'package.json'));
  cpSync(path.join(realBetterSqlite, 'lib'), path.join(pkg, 'lib'), { recursive: true });
  // A prebuild for a platform that is definitely not this one, so binding.js
  // finds the directory but no file it can resolve for this host. Mirrors an
  // afterPack prune that kept the wrong target.
  mkdirSync(path.join(pkg, 'prebuilds'));
  writeFileSync(path.join(pkg, 'prebuilds', 'aix-ppc64.node'), 'not a real binding');
  return resources;
}

afterEach(() => {
  resetSqliteChannel();
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('bundled channel binding resolution', () => {
  it('opens a database through the binding inside the app Resources', () => {
    useBundledSqlite(resourcesWithRealBinding());

    const dbPath = path.join(scratch(), 'probe.db');
    const db = openDatabase(dbPath);
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, label TEXT)');
    db.prepare('INSERT INTO t (id, label) VALUES (?, ?)').run(1, 'bundled');
    expect(db.prepare('SELECT label FROM t WHERE id = 1').get()).toEqual({ label: 'bundled' });
    db.close();
  });

  it('names the path it looked for when the app carries no binding', () => {
    const resources = scratch();
    useBundledSqlite(resources);

    let message = '';
    try {
      openDatabase(path.join(resources, 'x.db'));
    } catch (err) {
      message = (err as Error).message;
    }

    expect(message).toContain(path.join(resources, 'node_modules', 'better-sqlite3'));
    expect(message).toContain(`app resources: ${resources}`);
  });

  it('reports the expected and present prebuilds when none match this host', () => {
    useBundledSqlite(resourcesWithNoUsablePrebuild());

    let message = '';
    try {
      openDatabase(path.join(scratch(), 'x.db'));
    } catch (err) {
      message = (err as Error).message;
    }

    expect(message).toContain(`expected prebuild: prebuilds/${process.platform}-${process.arch}`);
    expect(message).toContain('prebuilds present: aix-ppc64.node');
  });
});

describe('NIMBALYST_BETTER_SQLITE3_NATIVE', () => {
  afterEach(() => {
    delete process.env.NIMBALYST_BETTER_SQLITE3_NATIVE;
  });

  it('rejects a path that does not exist instead of handing it to the loader', () => {
    const missing = path.join(scratch(), 'nope.node');
    process.env.NIMBALYST_BETTER_SQLITE3_NATIVE = missing;
    useBundledSqlite(resourcesWithRealBinding());

    expect(() => openDatabase(path.join(scratch(), 'x.db'))).toThrow(
      /NIMBALYST_BETTER_SQLITE3_NATIVE points at a file that does not exist/,
    );
  });
});
