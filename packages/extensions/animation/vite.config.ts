import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { createManifestValidationPlugin } from '@nimbalyst/extension-sdk/vite';

export default defineConfig({
  plugins: [
    react({ jsxRuntime: 'automatic', jsxImportSource: 'react' }),
    createManifestValidationPlugin(),
  ],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  mode: 'production',
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.tsx'),
      formats: ['es'],
      fileName: () => 'index.mjs',
    },
    rollupOptions: {
      // Host-provided singletons must never be bundled -- see the pdf-viewer
      // config's note on why pulling in @nimbalyst/runtime breaks the browser
      // build.
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        'lexical',
        /^@lexical\//,
        /^@nimbalyst\/runtime/,
        '@nimbalyst/editor-context',
        'yjs',
        /^y-protocols(\/.*)?$/,
      ],
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
        },
        assetFileNames: (assetInfo) => {
          if (assetInfo.names?.some((name) => name.endsWith('.css'))) {
            return 'style.css';
          }
          return assetInfo.names?.[0] || 'asset';
        },
        inlineDynamicImports: true,
      },
    },
    outDir: 'dist',
    emptyOutDir: true,
  },
});
