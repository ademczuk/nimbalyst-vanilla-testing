import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { findGuessingPolicyReads, SYNC_LANE_FILES } from '../check-tracker-policy-reads.mjs';

const scriptPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../check-tracker-policy-reads.mjs',
);

function fixture(name, source) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tracker-policy-gate-'));
  const file = path.join(dir, name);
  writeFileSync(file, source, 'utf8');
  return file;
}

// The exact shape that shipped: the display-only read feeding a sync decision.
test('flags the guessing read on a sync-lane file', () => {
  const file = fixture('trackerItemBackfill.ts', `
    import { getEffectiveTrackerSharingPolicy } from '../TrackerPolicyService';
    const policy = getEffectiveTrackerSharingPolicy(workspacePath, row.type);
  `);
  const violations = findGuessingPolicyReads([file]);
  // Once for the import, once for the call -- both are the thing to remove.
  assert.equal(violations.length, 2);
  assert.equal(violations[0].kind, 'guessing-read');
});

test('accepts the explicit resolver', () => {
  const file = fixture('trackerItemBackfill.ts', `
    import { resolveTrackerSharingPolicy } from '../TrackerPolicyService';
    const resolution = resolveTrackerSharingPolicy(workspacePath, row.type);
    if (!resolution.known) return 'abort';
  `);
  assert.deepEqual(findGuessingPolicyReads([file]), []);
});

// A guarded list is worthless if the thing it guards moved away from it.
test('fails when a listed sync-lane file no longer exists', () => {
  const violations = findGuessingPolicyReads(['packages/electron/src/main/services/tracker/gone.ts']);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].kind, 'missing');
});

test('every listed sync-lane file exists', () => {
  const missing = findGuessingPolicyReads(SYNC_LANE_FILES).filter((v) => v.kind === 'missing');
  assert.deepEqual(missing, []);
});

test('passes over the real sync lane and exits zero', () => {
  const result = spawnSync(process.execPath, [scriptPath], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
