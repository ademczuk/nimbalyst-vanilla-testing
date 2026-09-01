#!/usr/bin/env node
/**
 * `nim` entry for the copy that ships inside the Nimbalyst app.
 *
 * Identical to `cli.ts` except that it declares the bundled channel first, so
 * the SQLite binding is loaded from the app's own per-target copy rather than
 * from a node_modules this build does not have. See db/nativeBinding.ts.
 *
 * PACKAGING CONTRACT: this file must end up at
 * `<Resources>/nim/dist/bin/cli-bundled.js`, so that walking three directories
 * up from it lands on the app's `Resources`, alongside
 * `node_modules/better-sqlite3`. If packaging puts it somewhere else, the first
 * database open fails with a message naming the directory it derived -- it does
 * not go looking, and it does not fall back to another copy of the binding.
 *
 * Copy the whole of `dist`, including the generated `dist/package.json`. The
 * build is ESM in `.js` files and Node takes that from the nearest package.json,
 * so without it the app's copy is parsed as CommonJS and dies on the first
 * import, before any of the above runs.
 *
 * Deliberately NOT registered in package.json's `bin`: npm users must get the
 * ordinary entry, and this one is invoked by path from the app.
 */
import { resolveBundledResourcesDir, useBundledSqlite } from '../db/nativeBinding.js';
import { main } from '../index.js';

useBundledSqlite(resolveBundledResourcesDir(import.meta.url));

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    process.stderr.write(`nim: fatal: ${err?.message ?? err}\n`);
    process.exitCode = 3;
  });
