import { defineConfig } from 'vite';
import { resolve } from 'path';
import { builtinModules } from 'module';

// Backend module bundle. Runs in an Electron utility process (Node), loaded by
// the host's extensionBackendBootstrap via dynamic import. It has no runtime
// dependencies beyond Node builtins and global fetch.
export default defineConfig({
  mode: 'production',
  build: {
    lib: {
      entry: resolve(__dirname, 'src/backend.ts'),
      formats: ['es'],
      fileName: () => 'backend.js',
    },
    rollupOptions: {
      external: [/^node:/, ...builtinModules],
      output: { inlineDynamicImports: true },
    },
    target: 'node18',
    outDir: 'dist',
    // Do NOT wipe dist: the shell build (vite.config.ts) emits index.js here first.
    emptyOutDir: false,
    sourcemap: true,
    minify: false,
  },
});
