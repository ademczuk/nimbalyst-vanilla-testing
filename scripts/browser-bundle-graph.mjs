import path from 'node:path';
import { build } from 'esbuild';

export function normalizeBrowserModuleId(moduleId) {
  return moduleId.replace(/\\/g, '/').replace(/\?.*$/, '');
}

export function findBrowserDependencyViolations(moduleIds, categories) {
  const normalized = moduleIds.map(normalizeBrowserModuleId);
  return categories.map((category) => ({
    name: category.name,
    hits: normalized.filter(category.test),
  })).filter((category) => category.hits.length > 0);
}

/** Shared esbuild graph walker for browser-boundary gates. */
export async function collectBrowserBundleGraph({
  repoRoot,
  entryPoints,
  outdir,
  plugins = [],
  treeShaking = false,
}) {
  const resolvedSpecifiers = [];
  const result = await build({
    absWorkingDir: repoRoot,
    bundle: true,
    entryPoints,
    format: 'esm',
    logLevel: 'silent',
    metafile: true,
    outdir,
    platform: 'browser',
    treeShaking,
    write: false,
    // Runtime source is compiled by Vite everywhere it actually ships, so these
    // gates have to understand Vite's `?raw` suffix too -- otherwise esbuild
    // cannot pick a loader and the whole boundary analysis aborts instead of
    // reporting on the graph. See runtime/src/env.d.ts for the matching types.
    loader: { '.yaml': 'text', '.yml': 'text' },
    plugins: [
      {
        name: 'record-browser-dependencies',
        setup(buildApi) {
          buildApi.onResolve({ filter: /.*/ }, (args) => {
            resolvedSpecifiers.push(args.path);
            return null;
          });
        },
      },
      ...plugins,
      {
        name: 'vite-raw-suffix',
        setup(buildApi) {
          buildApi.onResolve({ filter: /\?raw$/ }, (args) => ({
            path: path.resolve(args.resolveDir, args.path.replace(/\?raw$/, '')),
          }));
        },
      },
    ],
  });

  return {
    moduleIds: [
      ...resolvedSpecifiers,
      ...Object.keys(result.metafile.inputs),
    ],
    metafile: result.metafile,
  };
}
