import { useEffect, useMemo, useState } from 'react';
import {
  mergeGitOperationEntries,
  normalizeGitOperationEntry,
  selectLatestRunningGitOperation,
  selectLatestTerminalGitOperation,
  selectRunningGitOperations,
  type GitOperationLogEvent,
  type GitOperationLogWireEntry,
} from '@nimbalyst/extension-sdk/git-operation-log';

export type GitActivityEntry = GitOperationLogWireEntry;

export interface GitActivity {
  /** Every Git command still in flight for this workspace, oldest first. */
  runningEntries: GitActivityEntry[];
  /** The one a single-line indicator should name, or undefined when idle. */
  latestRunningEntry: GitActivityEntry | undefined;
  /** The most recently settled command, for post-run feedback. */
  latestTerminalEntry: GitActivityEntry | undefined;
}

const EMPTY_ACTIVITY: GitActivity = {
  runningEntries: [],
  latestRunningEntry: undefined,
  latestTerminalEntry: undefined,
};

/**
 * Project the main-process Git operation journal for the active workspace.
 *
 * This is the same journal the Git extension's Output tab renders, deliberately:
 * before this existed the title bar tracked its own `busyAction` flag, so a push
 * started from the Git panel was invisible up top and the two surfaces could
 * disagree about whether anything was running. Both now read one source.
 *
 * Works with the Git extension disabled -- the journal and its IPC are core
 * services, not extension-owned.
 */
export function useGitActivity(workspacePath: string | null | undefined): GitActivity {
  const [entries, setEntries] = useState<GitActivityEntry[]>([]);

  useEffect(() => {
    // Clear first: without this the previous workspace's running command stays
    // on screen for the length of the new workspace's hydration round-trip.
    setEntries([]);
    if (!workspacePath) return;

    let disposed = false;
    const unsubscribe = window.electronAPI?.on?.(
      'git:operation-log-changed',
      (data: unknown) => {
        if (disposed) return;
        const event = data as GitOperationLogEvent;
        if (event.workspacePath !== workspacePath) return;
        if (event.type === 'clear') {
          setEntries([]);
          return;
        }
        setEntries((current) =>
          mergeGitOperationEntries(current, [normalizeGitOperationEntry(event.entry)]),
        );
      },
    );

    void window.electronAPI
      ?.invoke('git:operation-log:get', workspacePath)
      .then((result: unknown) => {
        if (disposed) return;
        const hydrated = (result as GitOperationLogWireEntry[]).map(normalizeGitOperationEntry);
        // Live events that landed while the read was in flight are newer than
        // anything it can contain, so they win the merge rather than being
        // overwritten by the older snapshot.
        setEntries((current) => mergeGitOperationEntries(hydrated, current));
      })
      .catch((error: unknown) => {
        console.error('[GitActivity] Failed to hydrate Git operation activity:', error);
      });

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [workspacePath]);

  return useMemo(() => {
    if (entries.length === 0) return EMPTY_ACTIVITY;
    return {
      runningEntries: selectRunningGitOperations(entries),
      latestRunningEntry: selectLatestRunningGitOperation(entries),
      latestTerminalEntry: selectLatestTerminalGitOperation(entries),
    };
  }, [entries]);
}
