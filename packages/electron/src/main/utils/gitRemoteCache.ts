/**
 * A short-lived cache in front of `git remote get-url origin`.
 *
 * `getRawGitRemote` spawns a git process every call and had no cache at all.
 * That is fine for one workspace and not fine for the callers that walk every
 * RECENT workspace: `getRecentWorkspaceRemoteStates` loops serially over all of
 * them (46 on the install profiled for NIM-3959), and `team:resolve-project-walk`
 * -- which drives that walk -- had been invoked 4,807 times in a single uptime.
 * Measured cost of one such walk: 909ms of main-thread time at 19.8ms a spawn,
 * matching the 2,013ms and 1,587ms `getRawGitRemote` spans in the CPU profiles
 * taken during the hangs.
 *
 * Two properties matter here:
 *
 * - **Negative results are cached.** A folder with no origin costs a full
 *   failed spawn, exactly as much as a successful one.
 * - **Lookups are single-flight per path.** The walk runs concurrently with
 *   itself, so without this a TTL cache still lets each concurrent walk spawn
 *   git for the same path before the first one resolves.
 *
 * The TTL is deliberately short rather than permanent. A remote URL is a
 * PERSISTED KEY -- every project row and personal-index hash is a SHA-256 of a
 * normalized form of it (see `gitUtils.legacyNormalizeGitRemote`) -- so serving
 * a stale remote indefinitely after `git remote set-url` would silently bind a
 * workspace to the wrong organization until the app restarted.
 */

export interface GitRemoteCacheOptions {
  /** How long a looked-up remote stays fresh. */
  ttlMs?: number;
  /** Injectable clock, for tests. */
  now?: () => number;
}

export interface GitRemoteCache {
  get: (workspacePath: string) => Promise<string | null>;
  /** Drops one path, or the whole cache when called with no argument. */
  invalidate: (workspacePath?: string) => void;
}

/**
 * Five minutes: long enough that a burst of walks costs one spawn per path,
 * short enough that a `git remote set-url` done in a terminal is picked up
 * without restarting the app.
 */
const DEFAULT_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  value: string | null;
  storedAt: number;
}

export function createGitRemoteCache(
  fetch: (workspacePath: string) => Promise<string | null>,
  options: GitRemoteCacheOptions = {},
): GitRemoteCache {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = options.now ?? (() => Date.now());

  const entries = new Map<string, CacheEntry>();
  const inFlight = new Map<string, Promise<string | null>>();

  return {
    async get(workspacePath: string): Promise<string | null> {
      const entry = entries.get(workspacePath);
      if (entry && now() - entry.storedAt < ttlMs) return entry.value;

      const pending = inFlight.get(workspacePath);
      if (pending) return pending;

      const request = fetch(workspacePath)
        .then((value) => {
          entries.set(workspacePath, { value, storedAt: now() });
          return value;
        })
        .finally(() => {
          // Cleared on rejection too, so a transient failure is not cached as
          // a permanently pending lookup.
          inFlight.delete(workspacePath);
        });

      inFlight.set(workspacePath, request);
      return request;
    },

    invalidate(workspacePath?: string): void {
      if (workspacePath === undefined) {
        entries.clear();
        return;
      }
      entries.delete(workspacePath);
    },
  };
}
