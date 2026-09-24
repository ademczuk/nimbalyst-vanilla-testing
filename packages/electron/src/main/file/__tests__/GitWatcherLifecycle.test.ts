// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  windows: new Set<string>(),
  roots: new Map<string, string[]>(),
  states: new Map<string, any>(),
  subscribe: vi.fn(),
  pruneUnused: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../window/windowState', () => ({
  anyWindowReferencesWorkspace: (path: string) => mocks.windows.has(path),
  listOpenWorkspacePaths: () => [...mocks.windows],
}));
vi.mock('../../utils/store', () => ({ getWorkspaceRoots: (path: string) => mocks.roots.get(path) ?? [path] }));
vi.mock('@nimbalyst/runtime/ai/server/SessionStateManager', () => ({
  getSessionStateManager: () => ({
    getTrackedSessionIds: () => [...mocks.states.keys()],
    getSessionState: (id: string) => mocks.states.get(id),
    subscribe: mocks.subscribe,
  }),
}));
vi.mock('../GitRefWatcher', () => ({ gitRefWatcher: { pruneUnused: mocks.pruneUnused } }));
vi.mock('../../utils/logger', () => ({ logger: { main: { error: vi.fn() } } }));
import { isGitRepositoryInUse, initGitWatcherLifecycle } from '../GitWatcherLifecycle';

beforeEach(() => {
  mocks.windows.clear();
  mocks.roots.clear();
  mocks.states.clear();
});

it('preserves another project’s attached root and active or waiting agents, not idle CLI processes', () => {
  mocks.windows.add('/other');
  mocks.roots.set('/other', ['/other', '/shared']);
  expect(isGitRepositoryInUse('/shared/repo', new Set(['/closed']))).toBe(true);
  expect(isGitRepositoryInUse('/shared-other', new Set(['/closed']))).toBe(false);
  mocks.windows.clear();
  for (const status of ['running', 'waiting_for_input']) {
    mocks.states.set('agent', { workspacePath: '/closed', status });
    expect(isGitRepositoryInUse('/worktrees/branch', new Set(['/closed']))).toBe(true);
  }
  mocks.states.set('agent', { workspacePath: '/closed', status: 'idle' });
  expect(isGitRepositoryInUse('/worktrees/branch', new Set(['/closed']))).toBe(false);
});
it('retries cleanup when a retained agent finishes', () => {
  initGitWatcherLifecycle();
  const listener = mocks.subscribe.mock.calls[0][0];
  listener({ type: 'session:completed' });
  expect(mocks.pruneUnused).toHaveBeenCalledWith(isGitRepositoryInUse);
});

it.each(['running', 'waiting_for_input'])('defers service destruction until the last %s turn and window release the project', async (status) => {
  const { releaseWhenWorkspaceUnused, pruneUnusedGitWatchers } = await import('../GitWatcherLifecycle');
  const release = vi.fn();
  mocks.states.set('agent', { workspacePath: '/closed', status });
  releaseWhenWorkspaceUnused('/closed', release);
  expect(release).not.toHaveBeenCalled();
  mocks.windows.add('/closed');
  mocks.states.clear();
  await pruneUnusedGitWatchers();
  expect(release).not.toHaveBeenCalled();
  mocks.windows.clear();
  await pruneUnusedGitWatchers();
  expect(release).toHaveBeenCalledTimes(1);
});
