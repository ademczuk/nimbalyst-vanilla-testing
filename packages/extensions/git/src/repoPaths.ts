/**
 * Repository path helpers for a multi-root workspace.
 *
 * The panel gets its repo list from `git:list-workspace-repos` and its root
 * list from `host.getWorkspaceFolders()`; both are absolute paths, and
 * everything the UI needs from them is string work.
 */

/** Forward slashes, no trailing slash, for display and prefix comparison. */
function normalize(repoPath: string): string {
  return repoPath.replace(/\\/g, '/').replace(/\/+$/, '');
}

/** What a repo is called in the picker: its folder name. */
export function repoDisplayName(repoPath: string): string {
  return normalize(repoPath).split('/').pop() || repoPath;
}

/**
 * Disambiguating labels for a repo list.
 *
 * Two attached folders can easily share a basename (`app/api` and
 * `infra/api`), and a picker showing "api" twice is useless. Only the
 * colliding entries grow a parent segment; everything else stays the bare
 * folder name.
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
