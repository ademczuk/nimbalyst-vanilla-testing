import { useCallback, useEffect, useState } from 'react';
import {
  mergeGitOperationEntries,
  normalizeGitOperationEntry,
  type GitOperationLogEvent,
  type GitOperationLogWireEntry,
} from '@nimbalyst/extension-sdk/git-operation-log';

const ipc = (window as unknown as {
  electronAPI: {
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  };
}).electronAPI;

/**
 * The host's wire entry plus the panel's own presentation additions: a parsed
 * `timestamp` and the actionable hint we derive from a failure message.
 */
export interface OperationLogEntry
  extends Omit<GitOperationLogWireEntry, 'timestamp'> {
  timestamp: Date;
  suggestion?: string;
}

type WorkspaceEventSubscriber = (
  event: string,
  callback: (data: unknown) => void,
) => () => void;

function normalizeEntry(entry: GitOperationLogWireEntry): OperationLogEntry {
  const normalized = normalizeGitOperationEntry(entry);
  return {
    ...normalized,
    timestamp: new Date(normalized.timestamp),
    suggestion: normalized.error ? getSuggestionForError(normalized.error) : undefined,
  };
}

/**
 * Kept as a named re-export because this panel and the menu-bar indicator must
 * agree entry-for-entry; the rule itself lives with the wire contract.
 */
export const mergeOperationEntries = mergeGitOperationEntries<OperationLogEntry>;

/** Main-process journal projection. Renderer reloads cannot lose Git output. */
export function useOperationLog(
  workspacePath: string,
  subscribeToWorkspaceEvent: WorkspaceEventSubscriber,
) {
  const [entries, setEntries] = useState<OperationLogEntry[]>([]);

  useEffect(() => {
    let disposed = false;
    setEntries([]);
    const unsubscribe = subscribeToWorkspaceEvent('git:operation-log-changed', data => {
      if (disposed) return;
      const event = data as GitOperationLogEvent;
      if (event.type === 'clear') {
        setEntries([]);
        return;
      }
      setEntries(current => mergeOperationEntries(current, [normalizeEntry(event.entry)]));
    });

    void ipc.invoke('git:operation-log:get', workspacePath)
      .then(result => {
        if (disposed) return;
        const hydrated = (result as GitOperationLogWireEntry[]).map(normalizeEntry);
        // Preserve live events that arrived while the initial read was in flight.
        setEntries(current => mergeOperationEntries(hydrated, current));
      })
      .catch(error => {
        console.error('[GitOperationLog] Failed to hydrate operation history:', error);
      });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [workspacePath, subscribeToWorkspaceEvent]);

  const clearLog = useCallback(async () => {
    setEntries([]);
    await ipc.invoke('git:operation-log:clear', workspacePath);
  }, [workspacePath]);

  /** Existing call-site compatibility; recording now happens in Electron main. */
  const withLog = useCallback(async <T>(
    _command: string,
    operation: () => Promise<T>,
    _opts?: {
      formatOutput?: (result: T) => string | undefined;
      formatSuggestion?: (result: T) => string | undefined;
      isError?: (result: T) => boolean;
      getError?: (result: T) => string | undefined;
    },
  ): Promise<T> => operation(), []);

  return { entries, clearLog, withLog };
}

/** Map common git errors to actionable suggestions */
export function getSuggestionForError(error: string): string | undefined {
  const lower = error.toLowerCase();

  if (lower.includes('non-fast-forward') || lower.includes('rejected')) {
    return 'Pull changes first, then push again.';
  }
  if (lower.includes('uncommitted changes') || lower.includes('your local changes')) {
    return 'Commit or stash your changes first.';
  }
  if (lower.includes('authentication') || lower.includes('permission denied') || lower.includes('could not read from remote')) {
    return 'Check your credentials or SSH key configuration.';
  }
  if (lower.includes('lock') || lower.includes('index.lock')) {
    return 'Another git process may be running. If not, remove the lock file.';
  }
  if (lower.includes('conflict')) {
    return 'Resolve the conflicts, then continue or abort the operation.';
  }
  if (lower.includes('detached head')) {
    return 'Create a branch to save your work.';
  }
  return undefined;
}
