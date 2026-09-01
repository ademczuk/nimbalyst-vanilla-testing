import { defineConfig } from 'vitest/config';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export default defineConfig({
  resolve: {
    alias: [
      // Match the root config: test tracker-core's SOURCE, not its build. The
      // package's `exports` points at a gitignored `dist/`, so without this a
      // project-scoped run either exercises a stale build or fails outright on
      // a clean checkout where nothing has run `tsc -p packages/tracker-core`.
      {
        find: '@nimbalyst/tracker-core',
        replacement: path.join(repoRoot, 'packages/tracker-core/src'),
      },
    ],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // better-sqlite3 13 ships Node-API prebuilds, so the workspace install
    // loads under both system Node and Electron and needs no per-runtime
    // rebuild. The shared globalSetup is kept so this project run behaves
    // identically to the root suite: it probes the normal loader first and only
    // falls back to fetching an isolated prebuild for installs that predate the
    // Node-API bump. See db/nativeBinding.ts.
    globalSetup: ['../electron/vitest.globalSetup.ts'],
  },
});
