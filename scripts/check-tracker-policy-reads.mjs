#!/usr/bin/env node
/**
 * Keeps the display-only tracker sharing read out of the tracker sync lane.
 *
 * `getEffectiveTrackerSharingPolicy` collapses an unresolved policy to
 * `personal`. That is the safe direction for a *display* -- rendering a tracker
 * you cannot resolve as private understates rather than overstates sharing --
 * and the wrong direction for a *write*, because `personal` on a
 * previously-shared item means "delete it from the team room".
 *
 * NIM-2968: on 2026-08-14 the reconnect drain resolved 0 of 77 candidates to a
 * team policy in a workspace holding ~2,700 synced items, and issued 26 deletes
 * against the room. The registry read had failed; the collapse made that
 * indistinguishable from 26 deliberate unshares.
 *
 * Anything that decides `sync_status`, or push / skip / delete, must call
 * `resolveTrackerSharingPolicy` and handle `known: false` explicitly. This gate
 * exists because the two functions differ by one word at the call site and the
 * failure they separate is silent, nine-months-invisible data loss.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import ts from 'typescript';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

/** The read that guesses. Banned in the files below. */
const DISPLAY_ONLY_READ = 'getEffectiveTrackerSharingPolicy';

/**
 * Files on the tracker item sync lane -- every one of these turns a policy read
 * into a durable decision about whether the team's copy exists.
 *
 * Repo-relative. A path that no longer exists is itself a failure: it means the
 * lane moved and this list silently stopped guarding anything.
 */
export const SYNC_LANE_FILES = [
  'packages/electron/src/main/services/tracker/trackerItemBackfill.ts',
  'packages/electron/src/main/services/tracker/fileBodyPublication.ts',
];

/**
 * Call sites inside a lane file that are genuinely display-only. Each entry
 * must say why the answer never reaches a write.
 */
export const ALLOWLIST = [];

function readSource(relative) {
  // Absolute paths let the gate's own tests point it at a fixture.
  const full = path.isAbsolute(relative) ? relative : path.join(repoRoot, relative);
  let text;
  try {
    text = readFileSync(full, 'utf8');
  } catch {
    return null;
  }
  return ts.createSourceFile(full, text, ts.ScriptTarget.Latest, true);
}

export function findGuessingPolicyReads(files = SYNC_LANE_FILES) {
  const violations = [];
  for (const relative of files) {
    const sourceFile = readSource(relative);
    if (!sourceFile) {
      violations.push({ file: relative, line: 0, kind: 'missing' });
      continue;
    }
    const visit = (node) => {
      if (ts.isIdentifier(node) && node.text === DISPLAY_ONLY_READ) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        const allowed = ALLOWLIST.some((e) => e.file === relative && e.line === line + 1);
        if (!allowed) violations.push({ file: relative, line: line + 1, kind: 'guessing-read' });
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return violations;
}

export function checkTrackerPolicyReads() {
  const violations = findGuessingPolicyReads();
  if (violations.length > 0) {
    const missing = violations.filter((v) => v.kind === 'missing');
    const reads = violations.filter((v) => v.kind === 'guessing-read');
    const parts = [];
    if (reads.length > 0) {
      parts.push(
        `the tracker sync lane must not use ${DISPLAY_ONLY_READ}:\n`
        + reads.map((v) => `  + ${v.file}:${v.line}`).join('\n')
        + `\nUse resolveTrackerSharingPolicy and handle \`known: false\`. The display-only\n`
        + `read answers \`personal\` for a schema it merely failed to load, and \`personal\`\n`
        + `on a previously-shared row means delete it from the team room (NIM-2968).`,
      );
    }
    if (missing.length > 0) {
      parts.push(
        'these sync-lane files no longer exist, so this gate is guarding nothing:\n'
        + missing.map((v) => `  + ${v.file}`).join('\n')
        + '\nUpdate SYNC_LANE_FILES in scripts/check-tracker-policy-reads.mjs.',
      );
    }
    throw new Error(parts.join('\n\n'));
  }
  return violations;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    checkTrackerPolicyReads();
    console.log('[tracker-policy-reads] the tracker sync lane resolves policy explicitly.');
  } catch (error) {
    console.error(`[tracker-policy-reads] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
