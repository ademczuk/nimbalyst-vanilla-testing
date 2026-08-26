// @vitest-environment node
/**
 * `conf` has no read cache: its `get store()` runs readFileSync + JSON.parse on
 * every `.get()`. Against a workspace-settings.json that had grown to 7.5MB that
 * was ~19ms of synchronous main-thread time per call, and `getWorkspaceState`
 * sits on the hot path for team resolution and document sync. These cases pin
 * that the main process reads the file once and serves the rest from memory,
 * and that writes stay visible to the next read.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';

/** Counts full-store reads the way `conf` would perform them. */
let storeReads = 0;
let backing: Record<string, unknown> = {};

vi.mock('electron-store', () => {
  class FakeStore {
    path = '/mock/path/workspace-settings.json';
    get store() {
      storeReads++;
      return JSON.parse(JSON.stringify(backing));
    }
    get(key: string) {
      storeReads++;
      return JSON.parse(JSON.stringify(backing))[key];
    }
    set(key: string, value: unknown) {
      backing[key] = JSON.parse(JSON.stringify(value));
    }
    delete(key: string) {
      delete backing[key];
    }
  }
  return { default: FakeStore };
});

const WORKSPACE = '/tmp/workspace-cache-fixture';

describe('workspace store read-through cache', () => {
  beforeEach(async () => {
    backing = {};
    storeReads = 0;
    const { invalidateWorkspaceStoreCache } = await import('../store');
    invalidateWorkspaceStoreCache();
  });

  it('reads the backing store once across many getWorkspaceState calls', async () => {
    const { getWorkspaceState } = await import('../store');

    getWorkspaceState(WORKSPACE);
    const readsAfterFirst = storeReads;

    for (let i = 0; i < 25; i++) getWorkspaceState(WORKSPACE);

    expect(readsAfterFirst).toBeGreaterThan(0);
    // The 25 follow-up calls must not touch the backing store at all.
    expect(storeReads).toBe(readsAfterFirst);
  });

  it('serves a written value from cache without re-reading', async () => {
    const { getWorkspaceState, updateWorkspaceState } = await import('../store');

    getWorkspaceState(WORKSPACE);
    const readsBefore = storeReads;

    updateWorkspaceState(WORKSPACE, state => {
      state.localKeyPrefix = 'ACME';
    });

    expect(getWorkspaceState(WORKSPACE).localKeyPrefix).toBe('ACME');
    expect(storeReads).toBe(readsBefore);
  });

  it('re-reads the backing store after an explicit invalidation', async () => {
    const { getWorkspaceState, invalidateWorkspaceStoreCache } = await import('../store');

    getWorkspaceState(WORKSPACE);
    const readsBefore = storeReads;

    // Stands in for a writer outside store.ts, e.g. ProjectMigrationService.
    invalidateWorkspaceStoreCache();
    getWorkspaceState(WORKSPACE);

    expect(storeReads).toBeGreaterThan(readsBefore);
  });
});
