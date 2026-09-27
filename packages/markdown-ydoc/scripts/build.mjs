#!/usr/bin/env node
/**
 * Bundle `src/index.ts` into one Worker-safe ESM file.
 *
 * `production` conditions pick Lexical's prod builds directly; the default
 * entry would ship both builds and branch on `process.env.NODE_ENV`, which a
 * Worker without `nodejs_compat` does not have.
 *
 * The build fails if React, CSS, prismjs or any `.tsx` module reaches the
 * graph -- the whole point of this package is that none of them do.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const FORBIDDEN_INPUT = /(\.tsx$|\.css$|node_modules\/(react|react-dom|prismjs|jotai|@lexical\/react|@lexical\/code-prism)\/)/;

const result = await build({
  absWorkingDir: packageRoot,
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  mainFields: ['module', 'main'],
  conditions: ['production', 'import', 'default'],
  define: { 'process.env.NODE_ENV': '"production"' },
  minify: true,
  sourcemap: true,
  metafile: true,
  legalComments: 'none',
  logLevel: 'warning',
});

const forbidden = Object.keys(result.metafile.inputs).filter((input) => FORBIDDEN_INPUT.test(input));
if (forbidden.length > 0) {
  console.error('[markdown-ydoc] forbidden modules reached the Worker bundle:');
  for (const input of forbidden) console.error(`  ${input}`);
  process.exit(1);
}

const bytes = result.metafile.outputs['dist/index.js'].bytes;
console.log(`[markdown-ydoc] dist/index.js ${(bytes / 1024).toFixed(0)} KiB, ${Object.keys(result.metafile.inputs).length} inputs`);
