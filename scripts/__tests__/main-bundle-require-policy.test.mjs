import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  findChunksReenteringEntry,
  findRequireCacheSelfEviction,
  stripRequireCacheSelfEviction,
} from '../main-bundle-require-policy.mjs';

// Verbatim from node_modules/conf/dist/source/index.js, which electron-store
// pulls in and rollup inlines into the Electron main entry.
const CONF_SOURCE = `let parentDir = '';
try {
    // Prevent caching of this module so module.parent is always accurate.
    delete require.cache[__filename];
    parentDir = path.dirname(module.parent?.filename ?? '.');
}
catch (_c) { }
`;

test('the conf self-eviction is detected and removed', () => {
  assert.equal(findRequireCacheSelfEviction(CONF_SOURCE).length, 1);

  const { code, count } = stripRequireCacheSelfEviction(CONF_SOURCE);

  assert.equal(count, 1);
  assert.equal(findRequireCacheSelfEviction(code).length, 0);
  // The surrounding statements must survive -- parentDir is still computed.
  assert.match(code, /parentDir = path\.dirname/);
});

test('self-eviction detection survives reformatting and minification', () => {
  const minified = 'try{delete require.cache[__filename],e=n(t)}catch{}';
  const spaced = 'delete   require . cache [ __filename ] ;';

  assert.equal(findRequireCacheSelfEviction(minified).length, 1);
  assert.equal(findRequireCacheSelfEviction(spaced).length, 1);
  assert.equal(stripRequireCacheSelfEviction(spaced).count, 1);
});

test('stripping is a no-op when the pattern is absent', () => {
  const clean = 'delete require.cache[somethingElse];';

  assert.equal(findRequireCacheSelfEviction(clean).length, 0);
  assert.deepEqual(stripRequireCacheSelfEviction(clean), { code: clean, count: 0 });
});

test('lazy chunks that re-enter a main entry are reported', () => {
  // The shape rollup emitted for `await import("file-type")` (#1389).
  const violations = findChunksReenteringEntry(
    [
      { fileName: 'chunks/index-Ur9Qk5Rc.js', code: 'const index = require("../index.js");' },
      { fileName: 'chunks/esm-Ab12.js', code: 'import { x } from "../extensionBackendBootstrap.js";' },
      { fileName: 'chunks/self-contained.js', code: 'require("node:fs"); require("./sibling.js");' },
    ],
    ['index', 'extensionBackendBootstrap'],
  );

  assert.deepEqual(violations, [
    { fileName: 'chunks/index-Ur9Qk5Rc.js', specifiers: ['../index.js'] },
    { fileName: 'chunks/esm-Ab12.js', specifiers: ['../extensionBackendBootstrap.js'] },
  ]);
});

test('a chunk requiring an unrelated module is not a violation', () => {
  assert.deepEqual(
    findChunksReenteringEntry(
      [{ fileName: 'chunks/a.js', code: 'require("../indexed-db.js"); require("../../index.js")' }],
      ['index'],
    ),
    [],
  );
});
