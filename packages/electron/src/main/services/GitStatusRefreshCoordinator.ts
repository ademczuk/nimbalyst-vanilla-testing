import { BrowserWindow } from 'electron';
import { realpathSync } from 'fs';
import log from 'electron-log/main';

/** The branch/ahead/behind snapshot the title bar and Git panel both render. */
export interface GitBranchStatusSnapshot {
  branch: string;
  ahead: number;
  behind: number;
  hasUncommitted: boolean;
}

/**
 * `git:status-changed` payload. `workspacePath` alone is the legacy shape that
 * the index and ref watchers still send; consumers must keep handling it.
 */
export interface GitStatusChangedPayload {
  workspacePath: string;
  /**
   * The repository the snapshot describes. In a multi-root workspace this is
   * NOT necessarily the primary root, so a consumer showing one repo must
   * check it before applying `status` -- otherwise an attached repo's branch
   * lands on the primary repo's indicator.
   */
  repoPath?: string;
  /** Monotonic per-process. Lets a renderer discard an out-of-order snapshot. */
  revision?: number;
  /** Present when main already computed the status, saving a round-trip. */
  status?: GitBranchStatusSnapshot;
}

export interface GitStatusRefreshCoordinatorOptions {
  readStatus: (workspacePath: string) => Promise<GitBranchStatusSnapshot | null>;
  broadcast?: (payload: GitStatusChangedPayload) => void;
}

function defaultBroadcast(payload: GitStatusChangedPayload): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('git:status-changed', payload);
    }
  }
}

/**
 * Recompute and publish branch/ahead-behind status when a Git operation settles.
 *
 * This exists because `GitRefWatcher` watches the current branch ref and the
 * index, neither of which a fetch touches -- so a fetch that changed
 * `refs/remotes/*` left every surface showing stale behind counts until
 * something else happened to fire. Refreshing off the operation's own terminal
 * event closes that gap without recursively watching the whole ref tree.
 *
 * A failure or interruption refreshes too: a half-applied rebase or a rejected
 * push may still have moved refs, the index, or the worktree.
 */
export class GitStatusRefreshCoordinator {
  private readonly readStatus: (workspacePath: string) => Promise<GitBranchStatusSnapshot | null>;
  private readonly broadcast: (payload: GitStatusChangedPayload) => void;
  private readonly canonicalPaths = new Map<string, string>();
  /** Canonical path -> the refresh currently running for it. */
  private readonly inFlight = new Map<string, Promise<void>>();
  /** Canonical paths that changed again mid-refresh and need exactly one re-run. */
  private readonly requeued = new Set<string>();
  private revision = 0;

  constructor(options: GitStatusRefreshCoordinatorOptions) {
    this.readStatus = options.readStatus;
    this.broadcast = options.broadcast ?? defaultBroadcast;
  }

  /**
   * Ask for a refresh of `workspacePath`. Concurrent asks for the same
   * repository collapse into the in-flight read plus at most one re-run, so a
   * burst of finishing operations cannot fan out into a `git status` per event.
   */
  request(workspacePath: string): Promise<void> {
    if (!workspacePath) return Promise.resolve();
    const canonical = this.canonicalize(workspacePath);

    const running = this.inFlight.get(canonical);
    if (running) {
      // Something changed after the in-flight read started, so its result may
      // already be stale. Re-run once when it lands rather than dropping this.
      this.requeued.add(canonical);
      return running;
    }

    const run = this.refresh(workspacePath, canonical).finally(() => {
      this.inFlight.delete(canonical);
      if (this.requeued.delete(canonical)) {
        void this.request(workspacePath);
      }
    });
    this.inFlight.set(canonical, run);
    return run;
  }

  private async refresh(workspacePath: string, canonical: string): Promise<void> {
    let status: GitBranchStatusSnapshot | null;
    try {
      status = await this.readStatus(workspacePath);
    } catch (error) {
      // Keep the last confirmed counts on screen: publishing nothing is better
      // than replacing a real snapshot with fabricated zeros.
      log.warn('[GitStatusRefresh] Failed to refresh status for', canonical, error);
      return;
    }
    if (!status) return;

    // Every caller asks for a refresh of the path a git command ran in, which
    // is the repository -- so the two fields carry the same value here and
    // consumers that route on `repoPath` get an answer they can trust.
    this.broadcast({
      workspacePath,
      repoPath: workspacePath,
      revision: ++this.revision,
      status,
    });
  }

  private canonicalize(workspacePath: string): string {
    const cached = this.canonicalPaths.get(workspacePath);
    if (cached) return cached;
    try {
      // `.native` also normalizes case on macOS and Windows, so the same repo
      // reached by two spellings coalesces instead of refreshing twice.
      const canonical = realpathSync.native(workspacePath);
      this.canonicalPaths.set(workspacePath, canonical);
      return canonical;
    } catch {
      return workspacePath;
    }
  }
}

let singleton: GitStatusRefreshCoordinator | null = null;

export function setGitStatusRefreshCoordinator(
  coordinator: GitStatusRefreshCoordinator | null,
): void {
  singleton = coordinator;
}

/**
 * The coordinator, if `registerGitHandlers` has installed it. Callers outside
 * the Git IPC surface use this and no-op when Git handlers are not registered
 * (tests, and any window that comes up before registration).
 */
export function getGitStatusRefreshCoordinator(): GitStatusRefreshCoordinator | null {
  return singleton;
}

/** Request a post-operation status refresh, if the coordinator is installed. */
export function requestGitStatusRefresh(workspacePath: string): void {
  void singleton?.request(workspacePath);
}
