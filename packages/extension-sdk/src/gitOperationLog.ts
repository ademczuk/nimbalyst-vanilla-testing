/**
 * Wire contract and pure selectors for the host's Git operation journal.
 *
 * The journal lives in the Electron main process and is published over two host
 * channels: `git:operation-log:get` (hydration) and `git:operation-log-changed`
 * (live upsert/clear). Both the Git extension's Output tab and Nimbalyst's own
 * menu-bar indicator project the same journal, so the merge and "what is running
 * right now" rules have to agree exactly -- two surfaces disagreeing about
 * whether a push is still in flight is the bug this module exists to prevent.
 *
 * Everything here is pure: no React, no IPC, no host runtime.
 */

/** Terminal states are everything except `running`. */
export type GitOperationStatus = 'running' | 'success' | 'error' | 'interrupted';

/** Who started the command. Absent on journals written before agent activity existed. */
export type GitOperationSource = 'nimbalyst' | 'agent';

/**
 * How the command reached Git. `git` is an app-owned direct invocation with a
 * meaningful `args` array; `shell` is an observed command line whose Git segment
 * we detected but did not spawn ourselves.
 */
export type GitOperationExecutor = 'git' | 'shell';

/** An entry exactly as it crosses the IPC boundary (timestamps are epoch ms). */
export interface GitOperationLogWireEntry {
  id: string;
  timestamp: number;
  updatedAt: number;
  /** Redacted, display-ready command text. */
  command: string;
  executable: 'git';
  args: string[];
  cwd: string;
  status: GitOperationStatus;
  output: string;
  stdout: string;
  stderr: string;
  error?: string;
  exitCode?: number;
  durationMs?: number;
  source?: GitOperationSource;
  executor?: GitOperationExecutor;
  sessionId?: string;
  provider?: string;
  providerToolCallId?: string;
}

export type GitOperationLogEvent =
  | { workspacePath: string; type: 'upsert'; entry: GitOperationLogWireEntry }
  | { workspacePath: string; type: 'clear' };

/**
 * Window CustomEvent the host dispatches when the user asks to see Git activity
 * detail (for example from the menu-bar indicator's running-command row).
 *
 * The Git panel owns which tab is showing, and that state is private to the
 * extension bundle. Rather than let the host reach into it, the host states the
 * intent and the panel decides how to honour it. `detail.workspacePath` lets a
 * panel bound to a different workspace ignore the request.
 */
export const GIT_SHOW_OUTPUT_REQUEST_EVENT = 'nimbalyst:git-show-output';

export interface GitShowOutputRequestDetail {
  workspacePath: string;
}

/** The minimum shape the selectors below need. */
interface MergeableEntry {
  id: string;
  timestamp: number | Date;
  updatedAt: number;
  status: GitOperationStatus;
}

function toMillis(timestamp: number | Date): number {
  return typeof timestamp === 'number' ? timestamp : timestamp.getTime();
}

/**
 * Fill in metadata that predates the field. A journal written before agent
 * activity existed only ever recorded app-owned direct `git` invocations, so
 * that is what an absent `source`/`executor` means -- resolved here at the
 * projection boundary rather than by rewriting the persisted journal.
 */
export function normalizeGitOperationEntry(
  entry: GitOperationLogWireEntry,
): GitOperationLogWireEntry & {
  source: GitOperationSource;
  executor: GitOperationExecutor;
} {
  return {
    ...entry,
    source: entry.source ?? 'nimbalyst',
    executor: entry.executor ?? 'git',
  };
}

/**
 * Fold incoming entries into the current list, newest write per id wins.
 *
 * `updatedAt` is the tiebreak rather than arrival order because hydration and
 * the live subscription race: a `git:operation-log:get` response can land after
 * upserts it predates, and applying it blindly would rewind a finished
 * operation back to `running`.
 */
export function mergeGitOperationEntries<T extends MergeableEntry>(
  current: T[],
  incoming: T[],
): T[] {
  const byId = new Map(current.map((entry) => [entry.id, entry]));
  for (const entry of incoming) {
    const existing = byId.get(entry.id);
    if (!existing || entry.updatedAt >= existing.updatedAt) {
      byId.set(entry.id, entry);
    }
  }
  return Array.from(byId.values()).sort(
    (a, b) => toMillis(a.timestamp) - toMillis(b.timestamp),
  );
}

/** Every entry still in flight, oldest first. */
export function selectRunningGitOperations<T extends MergeableEntry>(entries: T[]): T[] {
  return entries.filter((entry) => entry.status === 'running');
}

/**
 * The entry a single-line indicator should name. Newest start wins: when an
 * agent kicks off a fetch while a push is already running, the thing the user
 * just caused is the more informative label.
 */
export function selectLatestRunningGitOperation<T extends MergeableEntry>(
  entries: T[],
): T | undefined {
  let latest: T | undefined;
  for (const entry of entries) {
    if (entry.status !== 'running') continue;
    if (!latest || toMillis(entry.timestamp) >= toMillis(latest.timestamp)) {
      latest = entry;
    }
  }
  return latest;
}

/** The most recently updated entry that has already settled, if any. */
export function selectLatestTerminalGitOperation<T extends MergeableEntry>(
  entries: T[],
): T | undefined {
  let latest: T | undefined;
  for (const entry of entries) {
    if (entry.status === 'running') continue;
    if (!latest || entry.updatedAt >= latest.updatedAt) {
      latest = entry;
    }
  }
  return latest;
}
