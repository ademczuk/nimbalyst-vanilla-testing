import { mergeConfig, defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import viteConfig from './vite.config';

export default mergeConfig(viteConfig, defineConfig({
  resolve: {
    alias: [
      { find: '@nimbalyst/tracker-core', replacement: resolve(import.meta.dirname, '../tracker-core/src') },
      { find: '@nimbalyst/tracker-schema', replacement: resolve(import.meta.dirname, '../tracker-schema/src') },
      { find: '@nimbalyst/tracker-engine', replacement: resolve(import.meta.dirname, '../tracker-engine/src') },
      {
        find: /^monaco-editor(\/.*)?$/,
        replacement: resolve(import.meta.dirname, '../../test-utils/monacoStub.ts'),
      },
    ],
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    server: { deps: { inline: [/y-monaco/] } },
  },
}));
