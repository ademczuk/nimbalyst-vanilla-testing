import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// Shell (renderer) bundle: the curator settings panel. The backend module
// (Jev sorter) is built separately by vite.backend.config.ts.
export default defineConfig({
  plugins: [
    react({
      jsxRuntime: 'automatic',
      jsxImportSource: 'react',
    }),
  ],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  mode: 'production',
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.tsx'),
      name: 'NimbalystKnowledgeExtension',
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        /^@nimbalyst\/runtime/,
        '@nimbalyst/extension-sdk',
        '@nimbalyst/editor-context',
      ],
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
          'react/jsx-runtime': 'jsxRuntime',
        },
        inlineDynamicImports: true,
      },
    },
    outDir: 'dist',
    // Shell builds first; it MAY clear dist. The backend build runs after with
    // emptyOutDir:false so it appends backend.js.
    emptyOutDir: true,
    sourcemap: true,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
