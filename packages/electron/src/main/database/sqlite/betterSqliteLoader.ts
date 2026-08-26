/**
 * better-sqlite3 module loading, shared by everything that needs to open a
 * SQLite handle: the live database, and the short-lived verification worker
 * that opens a backup file on its own thread.
 *
 * The constructor is required lazily so these modules can be statically
 * imported in environments where the native binding hasn't been compiled
 * (e.g. some test runners). The production main process always has it.
 */

export type SqliteCtor = typeof import('better-sqlite3');
export type SqliteDatabaseHandle = import('better-sqlite3').Database;

let cachedBetterSqlite: SqliteCtor | null = null;

export function loadBetterSqlite(): SqliteCtor {
  if (cachedBetterSqlite) return cachedBetterSqlite;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('better-sqlite3') as SqliteCtor | { default: SqliteCtor };
  cachedBetterSqlite = (mod as { default?: SqliteCtor }).default ?? (mod as SqliteCtor);
  return cachedBetterSqlite;
}

/**
 * Optional override for the native better-sqlite3 binding path. Set by
 * vitest.globalSetup.ts so unit tests can load a Node-ABI prebuild without
 * disturbing the Electron-ABI binary in `node_modules/.../build/Release/`
 * that the dev server depends on.
 */
export function nativeBindingOverride(): string | undefined {
  return process.env.NIMBALYST_BETTER_SQLITE3_NATIVE || undefined;
}
