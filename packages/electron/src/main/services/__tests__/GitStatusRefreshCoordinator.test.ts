import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
}));

vi.mock('electron-log/main', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import {
  GitStatusRefreshCoordinator,
  type GitBranchStatusSnapshot,
  type GitStatusChangedPayload,
} from '../GitStatusRefreshCoordinator';

const SNAPSHOT: GitBranchStatusSnapshot = {
  branch: 'main',
  ahead: 0,
  behind: 2,
  hasUncommitted: false,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('GitStatusRefreshCoordinator', () => {
  it('publishes one revisioned snapshot per settled operation', async () => {
    const broadcasts: GitStatusChangedPayload[] = [];
    const coordinator = new GitStatusRefreshCoordinator({
      readStatus: async () => SNAPSHOT,
      broadcast: (payload) => broadcasts.push(payload),
    });

    await coordinator.request('/repo');
    await coordinator.request('/repo');

    expect(broadcasts.map((b) => b.revision)).toEqual([1, 2]);
    expect(broadcasts[0].status).toEqual(SNAPSHOT);
  });

  it('names the repository the snapshot describes', async () => {
    // Multi-root: a consumer showing one repo routes on `repoPath`. Without it
    // an attached repo's branch lands on the primary repo's indicator.
    const broadcasts: GitStatusChangedPayload[] = [];
    const coordinator = new GitStatusRefreshCoordinator({
      readStatus: async () => SNAPSHOT,
      broadcast: (payload) => broadcasts.push(payload),
    });

    await coordinator.request('/workspace/attached-repo');

    expect(broadcasts[0].repoPath).toBe('/workspace/attached-repo');
  });

  it('collapses a burst of concurrent requests into one read plus one re-run', async () => {
    // Several operations finishing at once must not fan out into a `git status`
    // per event, but the last request still has to be honoured -- it may have
    // landed after the in-flight read already looked at the repository.
    const gate = deferred<GitBranchStatusSnapshot>();
    const readStatus = vi.fn().mockReturnValueOnce(gate.promise).mockResolvedValue(SNAPSHOT);
    const broadcasts: GitStatusChangedPayload[] = [];
    const coordinator = new GitStatusRefreshCoordinator({
      readStatus,
      broadcast: (payload) => broadcasts.push(payload),
    });

    const first = coordinator.request('/repo');
    void coordinator.request('/repo');
    void coordinator.request('/repo');
    gate.resolve(SNAPSHOT);
    await first;
    // Let the queued re-run settle.
    await new Promise((resolve) => setImmediate(resolve));

    expect(readStatus).toHaveBeenCalledTimes(2);
    expect(broadcasts).toHaveLength(2);
  });

  it('keeps the last confirmed counts when the status read fails', async () => {
    const broadcast = vi.fn();
    const coordinator = new GitStatusRefreshCoordinator({
      readStatus: async () => {
        throw new Error('git exploded');
      },
      broadcast,
    });

    await expect(coordinator.request('/repo')).resolves.toBeUndefined();
    // Publishing nothing leaves the real snapshot on screen; publishing zeros
    // would silently claim the branch is in sync when we do not know that.
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('publishes nothing for a path that is not a repository', async () => {
    const broadcast = vi.fn();
    const coordinator = new GitStatusRefreshCoordinator({
      readStatus: async () => null,
      broadcast,
    });

    await coordinator.request('/not-a-repo');

    expect(broadcast).not.toHaveBeenCalled();
  });
});
