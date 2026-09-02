/**
 * Attributing renderer-side paths to the repository that owns them.
 *
 * The repo list itself comes from main (`git:list-workspace-repos`, which walks
 * the filesystem); everything below is pure string work over that list, so a
 * view showing a hundred changed files resolves them all without a hundred IPC
 * round trips.
 *
 * These functions answer with the repos a PICKER shows -- the roots and the
 * repos one level below a container root. A submodule inside a listed repo
 * attributes to its parent here, which is what the repo picker and the
 * grouped-changes headers want; main's `resolveRepoForFile` is the exact
 * answer when a git command actually has to run against the right `.git`.
 */

/** Forward slashes, no trailing slash, for prefix comparison. */
function normalize(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

/** Last path segment -- what a repo is called in a picker or a group header. */
export function repoDisplayName(repoPath: string): string {
  const normalized = normalize(repoPath);
  return normalized.split('/').pop() || repoPath;
}

/**
 * Disambiguating labels for a repo list.
 *
 * Two roots can easily share a basename (`app/api` and `infra/api`), and a
 * picker showing "api" twice is useless. Only colliding entries grow a parent
 * segment; everything else stays the bare folder name.
 */
export function repoLabels(repoPaths: string[]): Record<string, string> {
  const counts = new Map<string, number>();
  for (const repoPath of repoPaths) {
    const name = repoDisplayName(repoPath);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  const labels: Record<string, string> = {};
  for (const repoPath of repoPaths) {
    const name = repoDisplayName(repoPath);
    if ((counts.get(name) ?? 0) < 2) {
      labels[repoPath] = name;
      continue;
    }
    const segments = normalize(repoPath).split('/');
    const parent = segments[segments.length - 2];
    labels[repoPath] = parent ? `${parent}/${name}` : name;
  }
  return labels;
}

/**
 * The repo in `repoPaths` that contains `filePath`, or null when none does.
 *
 * Deepest match wins, so a repo checked out inside another root is preferred
 * over the root that merely contains it.
 */
export function resolveRepoForPath(repoPaths: string[], filePath: string): string | null {
  if (!filePath) return null;
  const target = normalize(filePath);

  let best: string | null = null;
  let bestLength = -1;
  for (const repoPath of repoPaths) {
    const repo = normalize(repoPath);
    if (target !== repo && !target.startsWith(repo + '/')) continue;
    if (repo.length > bestLength) {
      best = repoPath;
      bestLength = repo.length;
    }
  }
  return best;
}

export interface RepoFileGroup {
  /** null for files that belong to no repo in the workspace. */
  repoPath: string | null;
  files: string[];
}

/**
 * Group paths by owning repo, repos in `repoPaths` order and unowned files
 * last. Preserves the caller's ordering within each group.
 *
 * Returns a single group for the ordinary case where every path lives in one
 * repo, so callers can render grouping headers only when `groups.length > 1`.
 */
export function groupPathsByRepo(repoPaths: string[], filePaths: string[]): RepoFileGroup[] {
  const byRepo = new Map<string | null, string[]>();
  for (const filePath of filePaths) {
    const repoPath = resolveRepoForPath(repoPaths, filePath);
    const existing = byRepo.get(repoPath);
    if (existing) {
      existing.push(filePath);
    } else {
      byRepo.set(repoPath, [filePath]);
    }
  }

  const groups: RepoFileGroup[] = [];
  for (const repoPath of repoPaths) {
    const files = byRepo.get(repoPath);
    if (files) groups.push({ repoPath, files });
  }
  const unowned = byRepo.get(null);
  if (unowned) groups.push({ repoPath: null, files: unowned });
  return groups;
}

/** Ask main which repositories this workspace spans, primary root first. */
export async function fetchWorkspaceRepos(workspacePath: string): Promise<string[]> {
  if (!workspacePath) return [];
  try {
    const result = await window.electronAPI?.invoke?.('git:list-workspace-repos', workspacePath);
    return Array.isArray(result?.repos) ? result.repos : [];
  } catch (error) {
    console.error('[workspaceRepos] Failed to list workspace repos:', error);
    return [];
  }
}
