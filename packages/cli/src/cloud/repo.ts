/**
 * Which team project a command addresses, resolved the way the wiki-keeper
 * skill does: `repo` is `git remote get-url origin`, and `.nimbalyst/wiki.json`
 * (`{ orgId, projectId }`) is an optional pin sent as `project`. The pin only
 * picks among projects the caller can already reach; it never grants access.
 *
 * GitHub-native mode (`NIM_GITHUB_NATIVE=on`) keeps the earlier `wikiId` /
 * `joinSecret` file and `wiki:<id>` addressing in `resolveRepo`.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { usageError } from '../cli/exitCodes.js';

/** GitHub-native mode's wiki.json. */
export interface WikiFile {
  wikiId?: string;
  joinSecret?: string;
}

/** Teams mode's wiki.json, and the `project` argument of every `wiki_*` tool. */
export interface ProjectPin {
  orgId: string;
  projectId: string;
}

export interface TeamsTarget {
  /** The tools' `repo` argument; absent for a checkout with no `origin`. */
  repo?: string;
  /** Directory `.nimbalyst/wiki.json` lives in (git toplevel, or the start dir). */
  root: string;
  /** Sent as `project`; from --org/--project, else wiki.json unless --repo was given. */
  project?: ProjectPin;
  /** Where `project` came from, for error messages. */
  projectSource?: 'flags' | 'wiki.json';
}

export interface RepoBinding {
  /** Value passed as the tools' `repo` argument. */
  repo: string;
  /** Directory `.nimbalyst/wiki.json` lives in (git toplevel, or the start dir). */
  root: string;
  wikiFile?: WikiFile;
}

function git(dir: string, args: string[]): string | undefined {
  try {
    return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || undefined;
  } catch {
    return undefined;
  }
}

/** The checkout's root (git toplevel, else the start dir) and its `origin` remote, if any. */
export function locateCheckout(startDir: string): { root: string; origin?: string } {
  const root = git(startDir, ['rev-parse', '--show-toplevel']) ?? startDir;
  return { root, origin: git(root, ['remote', 'get-url', 'origin']) };
}

export function wikiFilePath(root: string): string {
  return path.join(root, '.nimbalyst', 'wiki.json');
}

export function readWikiFile(root: string): WikiFile | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(wikiFilePath(root), 'utf8');
  } catch {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw);
    return {
      wikiId: typeof parsed?.wikiId === 'string' ? parsed.wikiId : undefined,
      joinSecret: typeof parsed?.joinSecret === 'string' ? parsed.joinSecret : undefined,
    };
  } catch (err: any) {
    throw usageError(`${wikiFilePath(root)} is not valid JSON: ${err?.message ?? err}`);
  }
}

export function readProjectPin(root: string): ProjectPin | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(wikiFilePath(root), 'utf8');
  } catch {
    return undefined;
  }
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (err: any) {
    throw usageError(`${wikiFilePath(root)} is not valid JSON: ${err?.message ?? err}`);
  }
  // A GitHub-native file (`wikiId`, `joinSecret`) is not a pin; ignore it.
  if (typeof parsed?.orgId === 'string' && parsed.orgId && typeof parsed?.projectId === 'string' && parsed.projectId) {
    return { orgId: parsed.orgId, projectId: parsed.projectId };
  }
  return undefined;
}

/**
 * Writes the pin, keeping keys nim does not own. The GitHub-native `wikiId` and
 * `joinSecret` are dropped: a pin carries no secret.
 */
export function writeProjectPin(root: string, pin: ProjectPin): void {
  const file = wikiFilePath(root);
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // absent or unreadable: start fresh
  }
  const { wikiId: _w, joinSecret: _j, ...kept } = existing;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ ...kept, orgId: pin.orgId, projectId: pin.projectId }, null, 2) + '\n');
}

/**
 * Teams mode. An explicit `--repo` or `--org/--project` describes some other
 * target, so the current directory's wiki.json is not read at all: mixing a pin
 * for this checkout into a call about another repo would address the wrong
 * project.
 */
export function resolveTeamsTarget(
  startDir: string,
  opts: { repo?: string; project?: ProjectPin } = {},
): TeamsTarget {
  const { root, origin: repo } = locateCheckout(startDir);
  if (opts.repo || opts.project) {
    return {
      root,
      repo: opts.repo ?? repo,
      project: opts.project,
      projectSource: opts.project ? 'flags' : undefined,
    };
  }
  const project = readProjectPin(root);
  if (!repo && !project) {
    throw usageError(
      `No wiki for ${root}: it has no 'origin' remote and no .nimbalyst/wiki.json pin. Pass --repo, or --org and --project.`,
    );
  }
  return { root, repo, project, projectSource: project ? 'wiki.json' : undefined };
}

/** Merges into `.nimbalyst/wiki.json`, keeping any keys nim does not own. */
export function writeWikiFile(root: string, patch: WikiFile): void {
  const file = wikiFilePath(root);
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // absent or unreadable: start fresh
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ ...existing, ...patch }, null, 2) + '\n');
}

/** github.com in any of the forms `git remote get-url` prints. */
function isGithubRemote(remote: string): boolean {
  return /^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/(?:[^@/]+@)?|[^@/]+@)github\.com[:/]/i.test(remote);
}

/**
 * GitHub-native mode only. Same rule as the plugin's skills (tool contract rev 3): a GitHub repo is
 * addressed by its remote, with any `joinSecret` from wiki.json presented
 * alongside; `wiki:<wikiId>` is for repos without a GitHub remote.
 */
export function resolveRepo(
  startDir: string,
  explicitRepo?: string,
  opts: { creating?: boolean } = {},
): RepoBinding {
  const root = git(startDir, ['rev-parse', '--show-toplevel']) ?? startDir;
  const wikiFile = readWikiFile(root);
  if (explicitRepo) return { repo: explicitRepo, root, wikiFile };
  const remote = git(root, ['remote', 'get-url', 'origin']);
  if (wikiFile?.wikiId && !(remote && isGithubRemote(remote))) {
    return { repo: `wiki:${wikiFile.wikiId}`, root, wikiFile };
  }
  if (!remote) {
    // Contract rev 9: `wiki_create` takes `wiki:new` for a repo with nothing to key on.
    if (opts.creating) return { repo: 'wiki:new', root, wikiFile };
    throw usageError(
      `No wiki for ${root}: it has no 'origin' remote and no .nimbalyst/wiki.json. Pass --repo, or add a remote.`,
    );
  }
  return { repo: remote, root, wikiFile };
}
