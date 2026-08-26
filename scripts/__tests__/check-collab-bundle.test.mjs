import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COLLAB_BUNDLE_FORBIDDEN_DEPENDENCIES,
  findEagerEntryFiles,
  findBundledSingletons,
  findEmbeddedLaneViolations,
  findEntrySeparationViolations,
  findPublicTypeLeaks,
  findTrackersUiPersonalLaneViolations,
} from '../check-collab-bundle.mjs';
import { findBrowserDependencyViolations } from '../browser-bundle-graph.mjs';

test('classifies every forbidden browser-boundary category', () => {
  const violations = findBrowserDependencyViolations([
    'electron',
    'node:crypto',
    'path',
    '/repo/packages/runtime/src/ai/server/providers/SecretProvider.ts',
    '/repo/packages/runtime/src/editor/plugins/SpeechToTextPlugin/index.ts',
    '/repo/packages/extension-sdk/src/index.ts',
  ], COLLAB_BUNDLE_FORBIDDEN_DEPENDENCIES);

  assert.deepEqual(
    violations.map(({ name }) => name),
    [
      'Electron',
      'Node builtins',
      'filesystem',
      'secrets-bearing modules',
      'desktop-only editor plugins',
      'extension SDK leakage',
    ],
  );
});

test('allows the draggable block handle into the browser bundle', () => {
  const violations = findBrowserDependencyViolations([
    '/repo/packages/runtime/src/editor/plugins/DraggableBlockPlugin/index.tsx',
  ], COLLAB_BUNDLE_FORBIDDEN_DEPENDENCIES);

  assert.deepEqual(violations, []);
});

test('fails loudly when React, Lexical, RevoGrid, or Yjs is bundled', () => {
  const violations = findBundledSingletons([
    { id: '/repo/node_modules/react/index.js', external: false },
    { id: '/repo/node_modules/@lexical/yjs/LexicalYjs.mjs', external: false },
    { id: '/repo/node_modules/@revolist/react-datagrid/dist/react-datagrid.js', external: false },
    { id: '/repo/node_modules/@revolist/revogrid/dist/index.js?v=one', external: false },
    { id: '/repo/node_modules/yjs/dist/yjs.mjs', external: false },
    { id: 'react', external: true },
  ]);

  assert.deepEqual(violations.map(({ name }) => name), ['React', 'Lexical', 'RevoGrid', 'Yjs']);
});

test('fails loudly when Jotai or the runtime store resolves through two embedded lanes', () => {
  const violations = findEmbeddedLaneViolations([
    { id: '/repo/node_modules/jotai/esm/index.mjs', external: false },
    { id: '/repo/packages/collab-client/node_modules/jotai/esm/index.mjs', external: false },
    { id: '/repo/packages/runtime/src/store/index.ts', external: false },
    { id: '/repo/node_modules/@nimbalyst/runtime/dist/store/index.js', external: false },
  ]);

  assert.deepEqual(violations.map(({ name }) => name), ['Jotai', 'runtime store']);
});

test('keeps editor and docs-ui dependency closures separate', () => {
  const cleanReport = {
    chunks: [
      {
        fileName: 'editor.js', name: 'editor', isEntry: true,
        imports: [], dynamicImports: [], exports: [],
        modules: ['/repo/packages/runtime/src/editor/NimbalystEditor.tsx'],
      },
      {
        fileName: 'docs-ui.js', name: 'docs-ui', isEntry: true,
        imports: [], dynamicImports: [], exports: ['createCollabDocsSession'], modules: [
          '/repo/packages/collab-client/src/docs-ui/index.ts',
          '/repo/packages/collab-client/src/docs/session.ts',
          '/repo/packages/runtime/src/store/index.ts',
          '/repo/node_modules/jotai/esm/index.mjs',
        ],
      },
      {
        fileName: 'trackers-ui.js', name: 'trackers-ui', isEntry: true,
        imports: [], dynamicImports: [], exports: [], modules: [
          '/repo/packages/collab-client/src/trackers-ui/grid/TrackerGridSurface.tsx',
        ],
      },
    ],
  };
  assert.deepEqual(findEntrySeparationViolations(cleanReport), []);

  cleanReport.chunks[1].exports = [];
  assert.deepEqual(
    findEntrySeparationViolations(cleanReport),
    ['docs-ui entry does not export createCollabDocsSession'],
  );
  cleanReport.chunks[1].exports = ['createCollabDocsSession'];

  cleanReport.chunks[1].modules.push('/repo/packages/runtime/src/editor/Editor.tsx');
  assert.deepEqual(
    findEntrySeparationViolations(cleanReport),
    ['docs-ui entry pulls the editor/codec graph'],
  );
  cleanReport.chunks[1].modules.pop();

  // Tracker item bodies mount through the shared `editor` entry; a Lexical
  // graph appearing here means a second editor integration was written.
  cleanReport.chunks[2].modules.push('/repo/packages/runtime/src/collab-lexical/index.ts');
  assert.deepEqual(
    findEntrySeparationViolations(cleanReport),
    ['trackers-ui entry pulls the editor/codec graph'],
  );
  cleanReport.chunks[2].modules.pop();

  // The star and the dot are host-supplied slots. If either module is back in
  // the browser closure, someone restored a static import.
  cleanReport.chunks[2].modules.push(
    '/repo/packages/runtime/src/readReceipts/trackerUnreadAtoms.ts',
    '/repo/packages/runtime/src/plugins/TrackerPlugin/components/TrackerFavoriteStar.tsx',
    '/repo/packages/runtime/src/sync/CollabV3Sync.ts',
    '/repo/packages/electron/src/main/services/StytchAuthService.ts',
  );
  assert.deepEqual(findEntrySeparationViolations(cleanReport), [
    'trackers-ui entry pulls the personal lane (read-receipt / unread lane): '
    + '/repo/packages/runtime/src/readReceipts/trackerUnreadAtoms.ts',
    'trackers-ui entry pulls the personal lane (favorite star): '
    + '/repo/packages/runtime/src/plugins/TrackerPlugin/components/TrackerFavoriteStar.tsx',
    'trackers-ui entry pulls the personal lane (personal sync transport and key derivation): '
    + '/repo/packages/runtime/src/sync/CollabV3Sync.ts',
    'trackers-ui entry pulls the personal lane (personal JWT acquisition): '
    + '/repo/packages/electron/src/main/services/StytchAuthService.ts',
  ]);
});

test('the trackers-ui personal-lane gate spares the shared team JWT brand', () => {
  assert.deepEqual(findTrackersUiPersonalLaneViolations([
    '/repo/packages/runtime/src/auth/jwtScopes.ts',
    '/repo/packages/collab-client/src/trackers-ui/board/TrackerBoardCard.tsx',
  ]), []);
});

test('eager entry closure follows static imports but stops at dynamic imports', () => {
  const report = {
    chunks: [
      {
        fileName: 'editor.js', name: 'editor', isEntry: true,
        imports: ['chunks/editor-core.js'], dynamicImports: ['chunks/lazy-from-entry.js'], modules: [],
      },
      {
        fileName: 'chunks/editor-core.js', name: 'editor-core', isEntry: false,
        imports: ['chunks/static-transitive.js', 'react'],
        dynamicImports: ['chunks/large-lazy-feature.js'], modules: [],
      },
      {
        fileName: 'chunks/static-transitive.js', name: 'static-transitive', isEntry: false,
        imports: [], dynamicImports: [], modules: [],
      },
      {
        fileName: 'chunks/large-lazy-feature.js', name: 'large-lazy-feature', isEntry: false,
        imports: [], dynamicImports: [], modules: [],
      },
    ],
  };

  assert.deepEqual(
    findEagerEntryFiles(report, 'editor'),
    ['editor.js', 'chunks/editor-core.js', 'chunks/static-transitive.js'],
  );
});

// The public .d.ts files document the recommended `@nimbalyst/runtime` import,
// which means writing that import inside an example block. Scanning raw source
// reads the example as a real dependency and fails a tree with no leak in it —
// and an unpassable check is not a stricter check, it is one everyone bypasses.
test('ignores a private-package import that only appears in a comment', () => {
  const source = [
    '/**',
    ' * New pattern (recommended):',
    ' * ```typescript',
    " * import type { EditorHostProps } from '@nimbalyst/runtime';",
    ' * ```',
    ' */',
    '// see also: import { x } from "@nimbalyst/collab-client";',
    'export type Foo = string;',
  ].join('\n');
  assert.deepEqual(findPublicTypeLeaks(['editor.d.ts'], () => source), []);
});

test('still catches a real private-package import outside comments', () => {
  const source = [
    '/** Docs mentioning @nimbalyst/runtime harmlessly. */',
    "import type { Host } from '@nimbalyst/runtime';",
    "export type { Doc } from '@nimbalyst/collab-client/doc';",
    "export type { Manifest } from '@nimbalyst/extension-sdk';",
  ].join('\n');
  assert.deepEqual(
    findPublicTypeLeaks(['editor.d.ts'], () => source),
    [
      'editor.d.ts: @nimbalyst/runtime',
      'editor.d.ts: @nimbalyst/collab-client/doc',
      'editor.d.ts: @nimbalyst/extension-sdk',
    ],
  );
});

test('a // inside a string literal does not swallow the rest of the line', () => {
  const source = "export declare const URI = \"virtual://shared-home\"; import('@nimbalyst/runtime');";
  assert.deepEqual(
    findPublicTypeLeaks(['editor.d.ts'], () => source),
    ['editor.d.ts: @nimbalyst/runtime'],
  );
});

test('a comment between the keyword and the specifier does not splice a new token', () => {
  // Stripping to empty would turn this into a valid-looking `from'@nimbalyst/runtime'`.
  const source = "export type { A } from/**/'@nimbalyst/runtime';";
  assert.deepEqual(
    findPublicTypeLeaks(['editor.d.ts'], () => source),
    ['editor.d.ts: @nimbalyst/runtime'],
  );
});
