/**
 * Repository resolution for multi-root workspaces.
 *
 * The codebase historically equated "workspace path" with "the git repo". Once
 * a workspace can span several roots that stops holding: a root may be its own
 * repo, may be no repo at all, or may be a container holding several repos.
 * Everything git-related resolves through here instead of assuming the root.
 *
 * Two questions, deliberately answered by different mechanisms:
 *
 * - "Which repo owns THIS file?" -- `resolveRepoForFile`, exact, per file, via
 *   the existing `findGitRootForFile` walk. This is what status, diff, blame,
 *   and commit grouping need, and it handles submodules and nested repos for
 *   free because it walks up from the file.
 * - "Which repos does this workspace contain?" -- `listWorkspaceRepos`, a
 *   bounded scan used only to populate pickers and register ref watchers. It is
 *   lazy and cached because it touches the filesystem.
 */

import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { getWorkspaceRoots } from '../utils/store';
import { findGitRootForFile } from './GitStatusService';
import { isPathInWorkspace } from '../../shared/pathUtils';
import { logger } from '../utils/logger';

/**
 * Discovered repos per root. Repos do not appear or vanish during a session in
 * any way we need to react to, and the scan is a `readdirSync` per root, so a
 * plain memo is enough. Cleared on attach/detach and by tests.
 */
const reposByRoot = new Map<string, string[]>();

/** Test-only, and called on attach/detach so a new root is scanned once. */
export function clearWorkspaceRepoCache(rootPath?: string): void {
  if (rootPath) {
    reposByRoot.delete(rootPath);
  } else {
    reposByRoot.clear();
  }
}

function isRepo(dir: string): boolean {
  try {
    return existsSync(join(dir, '.git'));
  } catch {
    return false;
  }
}

/**
 * Repos directly under a root.
 *
 * A root that is itself a repo answers with just itself: its nested repos and
 * submodules are reached per file by `resolveRepoForFile`, and listing them
 * here would put every submodule in the repo picker. A root that is NOT a repo
 * is treated as a container and scanned one level down -- deep enough for the
 * "folder full of checkouts" case, shallow enough that attaching a large
 * directory does not walk it.
 */
function scanRootForRepos(rootPath: string): string[] {
  if (isRepo(rootPath)) {
    return [rootPath];
  }

  try {
    return readdirSync(rootPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => join(rootPath, entry.name))
      .filter(isRepo);
  } catch (error) {
    logger.main.warn('[workspaceRepos] Could not scan root for repos:', rootPath, error);
    return [];
  }
}

/** Repos under one root, cached. */
export function listReposForRoot(rootPath: string): string[] {
  let repos = reposByRoot.get(rootPath);
  if (!repos) {
    repos = scanRootForRepos(rootPath);
    reposByRoot.set(rootPath, repos);
  }
  return repos;
}

/**
 * Every repo this workspace spans, in root order, deduplicated. Empty when no
 * root is or contains a repo -- a perfectly valid workspace, and callers must
 * handle it rather than assuming index 0 exists.
 */
export function listWorkspaceRepos(workspacePath: string): string[] {
  const seen = new Set<string>();
  const repos: string[] = [];
  for (const rootPath of getWorkspaceRoots(workspacePath)) {
    for (const repo of listReposForRoot(rootPath)) {
      if (!seen.has(repo)) {
        seen.add(repo);
        repos.push(repo);
      }
    }
  }
  return repos;
}

/**
 * Every path a workspace-wide git scan has to visit: each root, plus each repo
 * discovered under it.
 *
 * A root that is itself a repo contributes only itself. A CONTAINER root -- one
 * that holds `checkouts/a` and `checkouts/b` -- is not a repo, so asking git
 * about the root returns nothing; its discovered repos have to be visited
 * individually or attached folders get no status at all. The roots stay in the
 * list so a repo created after the discovery cache warmed (`git init` mid
 * session) still answers.
 */
export function listRepoScanPaths(workspacePath: string): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const rootPath of getWorkspaceRoots(workspacePath)) {
    for (const candidate of [rootPath, ...listReposForRoot(rootPath)]) {
      if (!seen.has(candidate)) {
        seen.add(candidate);
        paths.push(candidate);
      }
    }
  }
  return paths;
}

/**
 * The repo that owns `filePath`, or null when the file is in no repo (or in no
 * root of this workspace).
 *
 * Resolves within the file's own root, so a file in an attached folder is never
 * attributed to the primary root's repo.
 */
export function resolveRepoForFile(workspacePath: string, filePath: string): string | null {
  const roots = getWorkspaceRoots(workspacePath);

  // Deepest containing root first: a root nested inside another root bounds the
  // walk more tightly, which is what its own `.git` deserves.
  const owningRoots = roots
    .filter((root) => isPathInWorkspace(filePath, root))
    .sort((a, b) => b.length - a.length);

  for (const root of owningRoots) {
    const repo = findGitRootForFile(filePath, root);
    if (repo) return repo;
  }
  return null;
}

/**
 * The repo a workspace-level git action should default to: the primary root's
 * repo when it has one, otherwise the first repo found in root order.
 *
 * Returns null for a workspace with no repos at all.
 */
export function resolveDefaultRepo(workspacePath: string): string | null {
  return listWorkspaceRepos(workspacePath)[0] ?? null;
}

/**
 * Group file paths by the workspace ROOT that owns them, primary root first.
 *
 * This is the coarser sibling of `groupFilesByRepo`, for the several services
 * whose repo walk is bounded by the path they are handed -- ask them about the
 * primary root alone and a file in an attached folder resolves to no repo at
 * all. Anything the roots do not contain stays with the primary root, which is
 * also where a relative path resolves.
 */
export function groupFilesByRoot(
  workspacePath: string,
  filePaths: string[],
): Map<string, string[]> {
  const roots = getWorkspaceRoots(workspacePath);
  const groups = new Map<string, string[]>();

  for (const filePath of filePaths) {
    // Deepest attached root wins; the primary root is the fallback, so it is
    // excluded from the match rather than competing on length.
    const owningRoot = roots
      .filter((root) => root !== workspacePath && isPathInWorkspace(filePath, root))
      .sort((a, b) => b.length - a.length)[0] ?? workspacePath;

    const existing = groups.get(owningRoot);
    if (existing) existing.push(filePath);
    else groups.set(owningRoot, [filePath]);
  }
  return groups;
}

/**
 * Group file paths by the repo that owns them, in root order. Files in no repo
 * land under the `null` key so callers can report them rather than silently
 * dropping them.
 */
export function groupFilesByRepo(
  workspacePath: string,
  filePaths: string[],
): Map<string | null, string[]> {
  const groups = new Map<string | null, string[]>();
  for (const filePath of filePaths) {
    const repo = resolveRepoForFile(workspacePath, filePath);
    const existing = groups.get(repo);
    if (existing) {
      existing.push(filePath);
    } else {
      groups.set(repo, [filePath]);
    }
  }
  return groups;
}
