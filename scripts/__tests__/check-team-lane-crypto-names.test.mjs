import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ALLOWED_NAMES,
  checkTeamLaneCryptoNames,
  findBannedNames,
  stripCommentsAndStrings,
} from '../check-team-lane-crypto-names.mjs';

function fixture(source) {
  const dir = mkdtempSync(path.join(tmpdir(), 'team-lane-crypto-gate-'));
  writeFileSync(path.join(dir, 'lane.ts'), source, 'utf8');
  return dir;
}

test('the real team-lane file set is clean', () => {
  assert.doesNotThrow(() => checkTeamLaneCryptoNames());
});

test('a new identifier claiming client-side crypto fails', () => {
  const dir = fixture('export function encryptItemForRoom(x: string) { return x; }\n');
  const violations = findBannedNames(['lane.ts'], dir);
  assert.deepEqual(violations.map((v) => v.name), ['encryptItemForRoom']);
});

test('allowlisted wire fields pass', () => {
  const dir = fixture('const { encrypted, iv } = msg; send({ encryptedPayload: encrypted, iv });\n');
  assert.deepEqual(findBannedNames(['lane.ts'], dir), []);
});

/**
 * The gate must not police prose. "The server encrypts at rest with the team
 * DEK" is true and is exactly the sentence we want people to keep writing --
 * banning it would push the documentation back out of the code.
 */
test('comments and string literals describing real server-side crypto are ignored', () => {
  const dir = fixture([
    '// The server decrypts rows it owns and sends them as plaintext.',
    '/* Encrypts at rest under the team DEK. */',
    'const label = "decrypting";',
    'const n = 1;',
  ].join('\n'));
  assert.deepEqual(findBannedNames(['lane.ts'], dir), []);
  assert.equal(stripCommentsAndStrings('/* encrypts */ const a = 1;').trim(), 'const a = 1;');
});

test('every allowlist entry carries a reason', () => {
  for (const [name, reason] of ALLOWED_NAMES) {
    assert.ok(reason.length > 40, `${name} needs a real explanation, not a placeholder`);
  }
});
