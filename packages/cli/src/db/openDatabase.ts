/**
 * Open a better-sqlite3 handle.
 *
 * The constructor comes from `nativeBinding.ts` rather than a static import,
 * because the bundled `nim` has no node_modules of its own and loads the copy
 * inside the Nimbalyst app instead. A static import would resolve at module
 * load, before any of that file's diagnostics could run, and fail with a bare
 * ERR_MODULE_NOT_FOUND. Read the header of nativeBinding.ts before changing
 * how the binding is resolved.
 */
import type Database from 'better-sqlite3';
import { loadSqliteCtor, nativeBindingOverride } from './nativeBinding.js';

export function openDatabase(
  path: string,
  options: Database.Options = {},
): Database.Database {
  const Ctor = loadSqliteCtor();
  const nativeBinding = nativeBindingOverride();
  return new Ctor(path, nativeBinding ? { ...options, nativeBinding } : options);
}
