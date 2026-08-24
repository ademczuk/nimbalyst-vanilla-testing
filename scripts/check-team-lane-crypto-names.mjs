#!/usr/bin/env node
/**
 * Guards the team sync lanes against identifiers that claim encryption the
 * client does not perform.
 *
 * Team lanes (trackers, team documents) are PLAINTEXT over TLS under
 * server-managed custody: the server holds the team DEK, encrypts at rest, and
 * can read the payloads. The client holds no team key and does no crypto. The
 * personal lanes (`CollabV3Sync`, `ProjectSyncProvider`) and the local replica
 * on disk are genuinely encrypted -- those files are deliberately NOT in scope
 * here, and renaming them to say "plaintext" would be a real regression.
 *
 * Why this gate exists: the retired client-managed lane left its vocabulary
 * behind. On 2026-08-24 an agent read `EncryptedTrackerItemEnvelope` /
 * `encryptedPayload` / `TrackerEnvelopeCrypto.ts`, concluded the server could
 * not read tracker payloads, and on that basis declared server-side conflict
 * merge architecturally impossible -- ruling out the correct design. The names
 * were not a cosmetic debt; they changed a conclusion.
 *
 * Scope note: this checks IDENTIFIERS, not prose. Comments and string literals
 * are stripped before matching, so "the server encrypts at rest with the team
 * DEK" is fine -- that sentence is true and worth keeping. What is banned is a
 * *name* that asserts client-side crypto.
 *
 * The allowlist below is the point of the gate. Adding a name to it forces you
 * to write down why an encryption-sounding identifier is correct. See
 * docs/IDENTITY_AUTH_AND_ROOMS.md section 6 for the lane table.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

/**
 * The team-lane file set. Deliberately an explicit list, not a glob: the whole
 * point is that this is lane-scoped, and a glob would eventually sweep in a
 * personal-lane file whose names are honest.
 */
export const TEAM_LANE_FILES = [
  'packages/collab-protocol/src/teamTracker.ts',
  'packages/runtime/src/sync/trackerProtocol.ts',
  'packages/runtime/src/sync/trackerEnvelopeCodec.ts',
  'packages/runtime/src/sync/TrackerSyncEngine.ts',
  'packages/runtime/src/sync/trackerPersistence.ts',
  'packages/runtime/src/sync/DocumentSync.ts',
];

/**
 * Encryption-sounding identifiers that are correct or unavoidable, each with
 * the reason it survives. Anything matching the ban pattern and absent here is
 * a failure.
 */
export const ALLOWED_NAMES = new Map([
  [
    'encryptedPayload',
    'Wire field on the tracker envelopes. Carries plaintext JSON. Renaming it '
      + 'breaks every deployed client -- this lane has no protocol version handshake.',
  ],
  [
    'encryptedUpdate',
    'Wire field on the document update message. Same compatibility surface as '
      + 'encryptedPayload.',
  ],
  [
    'encryptedState',
    'Wire field on the document snapshot message. Same compatibility surface.',
  ],
  [
    'encrypted',
    'Local binding destructured from the wire shape ({ encrypted, iv }) and the '
      + 'property name in that shape. Follows the wire field it came from.',
  ],
  [
    'orgKeyFingerprint',
    'Still populated, with a changed meaning: it now identifies the SERVER DEK, '
      + 'for diagnostics. Not dead, just mislabeled.',
  ],
]);

/** Identifier shapes that assert crypto. */
const BANNED_IDENTIFIER = /\b(?:[A-Za-z_$][A-Za-z0-9_$]*)?(?:[Ee]ncrypt|[Dd]ecrypt)[A-Za-z0-9_$]*\b/g;

/**
 * Remove comments and string/template literals so prose describing the (real)
 * server-side encryption does not trip the identifier check.
 */
export function stripCommentsAndStrings(source) {
  let out = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      while (i < n && source[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i += 1;
      while (i < n && source[i] !== quote) {
        if (source[i] === '\\') i += 1;
        i += 1;
      }
      i += 1;
      out += ' ';
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

export function findBannedNames(files = TEAM_LANE_FILES, root = repoRoot) {
  const violations = [];
  for (const rel of files) {
    const source = readFileSync(path.join(root, rel), 'utf8');
    const code = stripCommentsAndStrings(source);
    const lines = code.split('\n');
    lines.forEach((line, index) => {
      for (const match of line.matchAll(BANNED_IDENTIFIER)) {
        const name = match[0];
        if (ALLOWED_NAMES.has(name)) continue;
        violations.push({ file: rel, line: index + 1, name });
      }
    });
  }
  return violations;
}

export function checkTeamLaneCryptoNames() {
  const violations = findBannedNames();
  if (violations.length > 0) {
    throw new Error(
      'team-lane identifiers must not claim encryption the client does not perform:\n'
      + violations.map((v) => `  + ${v.file}:${v.line} ${v.name}`).join('\n')
      + '\nTeam lanes are plaintext over TLS; the server holds the team DEK and can\n'
      + 'read these payloads. Rename the identifier, or add it to ALLOWED_NAMES in\n'
      + `${path.relative(repoRoot, fileURLToPath(import.meta.url))} with the reason it is correct.\n`
      + 'Lane table: docs/IDENTITY_AUTH_AND_ROOMS.md section 6.',
    );
  }
  return violations;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    checkTeamLaneCryptoNames();
    console.log('[team-lane-crypto-names] no team-lane identifier claims client-side encryption.');
  } catch (error) {
    console.error(`[team-lane-crypto-names] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
