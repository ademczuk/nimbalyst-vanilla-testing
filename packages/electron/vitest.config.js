import { defineConfig } from 'vitest/config';
import path from 'path';
export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        setupFiles: ['./vitest.setup.ts'],
        include: [
            'src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
            'src/**/__tests__/**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'
        ],
        coverage: {
            reporter: ['text', 'json', 'html'],
            exclude: [
                'node_modules/',
                'dist/',
                'out/',
                'release/'
            ]
        },
        testTimeout: 10000,
        hookTimeout: 10000
    },
    resolve: {
        alias: {
            '@nimbalyst/tracker-core': path.resolve(__dirname, '../tracker-core/src'),
            '@nimbalyst/tracker-schema': path.resolve(__dirname, '../tracker-schema/src'),
            '@nimbalyst/tracker-engine': path.resolve(__dirname, '../tracker-engine/src'),
            '@': path.resolve(__dirname, './src')
        }
    },
    define: {
        'process.env.NODE_ENV': '"test"'
    }
});
