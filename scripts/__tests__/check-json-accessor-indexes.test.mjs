import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  collectIndexedJsonKeys,
  findArrowAccessorsSkippingIndexes,
} from '../check-json-accessor-indexes.mjs';

const scriptPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../check-json-accessor-indexes.mjs',
);

function fixture(name, source) {
  const dir = mkdtempSync(path.join(tmpdir(), 'json-accessor-gate-'));
  const file = path.join(dir, name);
  writeFileSync(file, source, 'utf8');
  return file;
}

function schemaFixture(sql) {
  const dir = mkdtempSync(path.join(tmpdir(), 'json-accessor-schema-'));
  writeFileSync(path.join(dir, '0001_initial.sql'), sql, 'utf8');
  return dir;
}

const SCHEMA = `
  CREATE UNIQUE INDEX IF NOT EXISTS idx_one_pending
    ON document_history(file_path)
    WHERE json_extract(metadata, '$.status') = 'pending-review';

  CREATE INDEX IF NOT EXISTS idx_preedit_session
    ON document_history(
      json_extract(metadata, '$.sessionId')
    )
    WHERE json_extract(metadata, '$.type') = 'pre-edit';
`;

test('collects indexed keys from both the column list and the partial WHERE', () => {
  const indexed = collectIndexedJsonKeys(schemaFixture(SCHEMA));
  const keys = indexed.get('document_history');
  assert.deepEqual(
    [...keys.keys()].sort(),
    ['metadata.sessionId', 'metadata.status', 'metadata.type'],
  );
  assert.deepEqual(keys.get('metadata.status'), ['idx_one_pending']);
  assert.deepEqual(keys.get('metadata.sessionId'), ['idx_preedit_session']);
});

// The exact shape that cost 31% of worker time: correct rows, full table scan.
test('flags a `->>` predicate that skips a partial index', () => {
  const indexed = collectIndexedJsonKeys(schemaFixture(SCHEMA));
  const file = fixture('HistoryManager.ts', `
    const rows = await database.query(\`
      SELECT file_path, content
      FROM document_history
      WHERE file_path = $1
        AND metadata->>'status' = 'pending-review'
    \`, [filePath]);
  `);
  const violations = findArrowAccessorsSkippingIndexes([file], indexed);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].expression, "metadata->>'status'");
  assert.deepEqual(violations[0].indexes, ['idx_one_pending']);
  assert.equal(violations[0].line, 6);
});

test('ignores a `->>` in a projection and an unindexed key in a predicate', () => {
  const indexed = collectIndexedJsonKeys(schemaFixture(SCHEMA));
  const file = fixture('HistoryManager.ts', `
    const rows = await database.query(\`
      SELECT metadata->>'status' as status
      FROM document_history
      WHERE metadata->>'tagId' = $1
    \`, [tagId]);
  `);
  assert.deepEqual(findArrowAccessorsSkippingIndexes([file], indexed), []);
});

test('accepts the jsonKeyExpr accessor', () => {
  const indexed = collectIndexedJsonKeys(schemaFixture(SCHEMA));
  const file = fixture('HistoryManager.ts', `
    const rows = await database.query(\`
      SELECT file_path FROM document_history
      WHERE \${this.md('status')} = 'pending-review'
    \`);
  `);
  assert.deepEqual(findArrowAccessorsSkippingIndexes([file], indexed), []);
});

test('passes over the real main-process tree and exits zero', () => {
  const result = spawnSync(process.execPath, [scriptPath], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
