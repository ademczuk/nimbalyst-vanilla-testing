import path from 'path';
import { getSessionStateManager } from '@nimbalyst/runtime/ai/server/SessionStateManager';
import { anyWindowReferencesWorkspace, listOpenWorkspacePaths } from '../window/windowState';
import { getWorkspaceRoots } from '../utils/store';
import { gitRefWatcher } from './GitRefWatcher';
import { logger } from '../utils/logger';

function containsPath(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

/** A shared root, another window or unfinished agent turn keeps monitoring alive. */
export function isGitRepositoryInUse(repoPath: string, owners: ReadonlySet<string>): boolean {
  if (anyWindowReferencesWorkspace(repoPath) || [...owners].some(owner => anyWindowReferencesWorkspace(owner))) return true;
  for (const workspace of listOpenWorkspacePaths()) {
    if (getWorkspaceRoots(workspace).some(root => containsPath(root, repoPath))) return true;
  }
  const manager = getSessionStateManager();
  return manager.getTrackedSessionIds().some(id => {
    const state = manager.getSessionState(id);
    if (!state?.workspacePath || (state.status !== 'running' && state.status !== 'waiting_for_input' && !state.isStreaming)) return false;
    return owners.has(state.workspacePath) || containsPath(state.workspacePath, repoPath) || containsPath(repoPath, state.workspacePath);
  });
}

const deferredReleases = new Map<string, () => void>();
const usageListeners = new Set<() => void>();

/** Additional workspace resources share the same close/turn-completion signals. */
export function onWorkspaceUsageChanged(listener: () => void): () => void {
  usageListeners.add(listener);
  return () => { usageListeners.delete(listener); };
}

export function notifyWorkspaceUsageChanged(): void {
  for (const listener of usageListeners) listener();
}

/** Keep shared services available until a closed project's last turn ends. */
export function releaseWhenWorkspaceUnused(workspacePath: string, release: () => void): void {
  if (isGitRepositoryInUse(workspacePath, new Set([workspacePath]))) {
    deferredReleases.set(workspacePath, release);
  } else {
    deferredReleases.delete(workspacePath);
    release();
  }
}

export async function pruneUnusedGitWatchers(): Promise<void> {
  notifyWorkspaceUsageChanged();
  await gitRefWatcher.pruneUnused(isGitRepositoryInUse);
  for (const [workspacePath, release] of deferredReleases) {
    releaseWhenWorkspaceUnused(workspacePath, release);
  }
}

let unsubscribe: (() => void) | undefined;
export function initGitWatcherLifecycle(): void {
  if (unsubscribe) return;
  unsubscribe = getSessionStateManager().subscribe(event => {
    if (event.type === 'session:completed' || event.type === 'session:error' || event.type === 'session:interrupted') {
      void pruneUnusedGitWatchers().catch(error => logger.main.error('Failed to release unused Git watchers:', error));
    }
  });
}
