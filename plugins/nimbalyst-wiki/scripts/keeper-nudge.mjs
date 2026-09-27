#!/usr/bin/env node
// Stop hook for the nimbalyst-wiki plugin. Asks the agent, at most once per
// session, to record what the session established in the team wiki, and only
// when the transcript shows substantive work: a git commit, at least N file
// edits, or a plan written. Every other stop passes through silently, and so
// does every stop in a directory with no git remote: a wiki is reached through
// a remote, so there is nothing to record into.
//
// A hook that fails must never trap the user in a session, so every error path
// exits 0 with no output. Plain Node, no dependencies.
//
// Env:
//   NIMBALYST_WIKI_NUDGE_MIN_EDITS   edits that count as substance (default 5)
//   NIMBALYST_WIKI_NUDGE_STATE_DIR   where once-per-session markers live (default:
//                                    $XDG_STATE_HOME/nimbalyst-wiki, else
//                                    ~/.claude/state/nimbalyst-wiki; created 0700)

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_MIN_EDITS = 5;
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const GIT_COMMIT = /\bgit\b[^|;&\n]*\bcommit\b/;
const PLAN_PATH = /(^|[\\/])(plans?|\.claude[\\/]plans)[\\/]|(^|[\\/])[^\\/]*plan[^\\/]*\.md$/i;
// The agent already recorded something through the plugin this session.
const WIKI_WRITE = /(^|__)wiki_(create_item|update_item|finish_changeset)$/;

export function minEdits(env = process.env) {
  const parsed = Number.parseInt(env.NIMBALYST_WIKI_NUDGE_MIN_EDITS ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MIN_EDITS;
}

function toolUses(line) {
  const content = line?.message?.content;
  return Array.isArray(content) ? content.filter((part) => part && part.type === 'tool_use') : [];
}

/** Summarizes a Claude Code JSONL transcript into the signals the nudge uses. */
export function assessTranscript(text) {
  const signals = { commits: 0, edits: 0, plans: 0, wikiWrites: 0 };
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue;
    let line;
    try {
      line = JSON.parse(raw);
    } catch {
      continue;
    }
    for (const use of toolUses(line)) {
      const name = String(use.name ?? '');
      const input = use.input ?? {};
      if (WIKI_WRITE.test(name)) signals.wikiWrites += 1;
      if (name === 'ExitPlanMode') signals.plans += 1;
      if (/git_commit/.test(name)) signals.commits += 1;
      if (name === 'Bash' && GIT_COMMIT.test(String(input.command ?? ''))) signals.commits += 1;
      if (EDIT_TOOLS.has(name)) {
        signals.edits += 1;
        const file = String(input.file_path ?? input.notebook_path ?? '');
        if (name === 'Write' && PLAN_PATH.test(file)) signals.plans += 1;
      }
    }
  }
  return signals;
}

export function substanceReason(signals, threshold) {
  if (signals.wikiWrites > 0) return null;
  const parts = [];
  if (signals.commits > 0) parts.push(`${signals.commits} git commit${signals.commits === 1 ? '' : 's'}`);
  if (signals.plans > 0) parts.push('a plan');
  if (signals.edits >= threshold) parts.push(`${signals.edits} file edits`);
  return parts.length > 0 ? parts.join(', ') : null;
}

// Per-user, not the shared temp dir: another local user could otherwise
// pre-create or read markers named after this user's session ids.
function stateDir(env) {
  if (env.NIMBALYST_WIKI_NUDGE_STATE_DIR) return env.NIMBALYST_WIKI_NUDGE_STATE_DIR;
  if (env.XDG_STATE_HOME) return path.join(env.XDG_STATE_HOME, 'nimbalyst-wiki');
  return path.join(env.HOME || homedir(), '.claude', 'state', 'nimbalyst-wiki');
}

function markerPath(sessionId, env) {
  const dir = stateDir(env);
  return { dir, file: path.join(dir, `${sessionId.replace(/[^A-Za-z0-9_-]/g, '_')}.nudged`) };
}

/** Whether `dir` is inside a git checkout with at least one remote. Any failure counts as no. */
export function hasGitRemote(dir) {
  try {
    const out = execFileSync('git', ['-C', dir, 'remote'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

/** Returns the hook's stdout JSON, or null to let the stop through. */
export function decide(input, env = process.env, remoteCheck = hasGitRemote) {
  if (!input || typeof input !== 'object' || input.stop_hook_active === true) return null;
  const sessionId = typeof input.session_id === 'string' ? input.session_id : '';
  const transcriptPath = typeof input.transcript_path === 'string' ? input.transcript_path : '';
  if (!sessionId || !transcriptPath) return null;

  const marker = markerPath(sessionId, env);
  if (existsSync(marker.file)) return null;
  const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd();
  if (!remoteCheck(cwd)) return null;

  const why = substanceReason(assessTranscript(readFileSync(transcriptPath, 'utf8')), minEdits(env));
  if (!why) return null;

  // Record before blocking: if the write fails, the catch lets the stop through
  // rather than risking a nudge on every turn.
  mkdirSync(marker.dir, { recursive: true, mode: 0o700 });
  writeFileSync(marker.file, new Date().toISOString());
  return {
    decision: 'block',
    reason:
      `This session did substantive work (${why}). Before stopping, run the /nimbalyst-wiki:capture command ` +
      'to record any decision made, question answered, or system fact established in the team wiki. ' +
      'If nothing is worth keeping, reply "nothing to record" and stop. This reminder appears once per session.',
  };
}

function main() {
  try {
    const raw = readFileSync(0, 'utf8');
    const result = decide(JSON.parse(raw));
    if (result) process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    // Never block a stop because the hook itself failed.
  }
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.on('uncaughtException', () => process.exit(0));
  main();
}
