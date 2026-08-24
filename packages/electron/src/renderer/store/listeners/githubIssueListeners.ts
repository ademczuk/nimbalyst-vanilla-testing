/**
 * GitHub issue listeners.
 *
 * Centralized IPC subscriber for the main-process poll scheduler's
 * `issue:list-updated` broadcast, debounced into `githubIssueListUpdatedAtom`
 * (a request atom the issue list view reacts to).
 *
 * Call initGithubIssueListeners() once in App.tsx on mount.
 */

import { store } from '@nimbalyst/runtime/store';
import { githubIssueListUpdatedAtom } from '../atoms/githubIssues';

const LIST_UPDATE_DEBOUNCE_MS = 150;

export function initGithubIssueListeners(): () => void {
  let version = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let latestPayload: { workspacePath: string; remote: string } | null = null;

  const unsubscribe = window.electronAPI.on(
    'issue:list-updated',
    (payload: { workspacePath: string; remote: string }) => {
      latestPayload = payload;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (!latestPayload) return;
        version += 1;
        store.set(githubIssueListUpdatedAtom, { version, payload: latestPayload });
        latestPayload = null;
      }, LIST_UPDATE_DEBOUNCE_MS);
    },
  );

  return () => {
    if (timer) clearTimeout(timer);
    timer = null;
    latestPayload = null;
    unsubscribe();
  };
}
