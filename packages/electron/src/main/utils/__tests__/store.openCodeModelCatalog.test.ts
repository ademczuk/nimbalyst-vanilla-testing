// @vitest-environment node
/**
 * The OpenCode catalog used to live in one global slot, so opening a second
 * project served the first project's discovered models (#1382). These cases pin
 * the per-workspace keying, the read of the legacy slot left behind by installs
 * that discovered before the change, and the eviction bound.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { OpenCodeModelCatalogCache } from '@nimbalyst/runtime/ai/server';

let backing: Record<string, any> = {};

vi.mock('electron-store', () => {
  class FakeStore {
    path = '/mock/path/config.json';
    get store() {
      return JSON.parse(JSON.stringify(backing));
    }
    get(key: string, fallback?: unknown) {
      return key in backing ? JSON.parse(JSON.stringify(backing[key])) : fallback;
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

function cacheFor(workspacePath: string, modelId: string, refreshedAt = 1): OpenCodeModelCatalogCache {
  return {
    version: 2,
    cacheKey: `identity:${workspacePath}`,
    workspacePath,
    models: [{ id: modelId, name: modelId, provider: 'opencode' }],
    refreshedAt,
  };
}

describe('OpenCode model catalog store', () => {
  beforeEach(() => {
    backing = {};
  });

  it('keeps each workspace on its own catalog', async () => {
    const { getOpenCodeModelCatalogCache, setOpenCodeModelCatalogCache } = await import('../store');

    setOpenCodeModelCatalogCache(cacheFor('/project-a', 'opencode:local/a-model'));
    setOpenCodeModelCatalogCache(cacheFor('/project-b', 'opencode:local/b-model'));

    expect(getOpenCodeModelCatalogCache('/project-a')?.models[0].id).toBe('opencode:local/a-model');
    expect(getOpenCodeModelCatalogCache('/project-b')?.models[0].id).toBe('opencode:local/b-model');
    expect(getOpenCodeModelCatalogCache('/project-c')).toBeNull();
  });

  it('honors a pre-migration global slot for its own workspace only', async () => {
    const { getOpenCodeModelCatalogCache } = await import('../store');

    // What an install that discovered before per-workspace storage has on disk.
    backing.openCodeModelCatalogCache = cacheFor('/project-a', 'opencode:local/legacy-model');

    expect(getOpenCodeModelCatalogCache('/project-a')?.models[0].id).toBe('opencode:local/legacy-model');
    expect(getOpenCodeModelCatalogCache('/project-b')).toBeNull();
  });

  it('evicts the least recently refreshed workspace past the cap', async () => {
    const { getOpenCodeModelCatalogCache, setOpenCodeModelCatalogCache } = await import('../store');

    for (let i = 0; i < 25; i++) {
      setOpenCodeModelCatalogCache(cacheFor(`/project-${i}`, `opencode:local/model-${i}`, i));
    }

    expect(Object.keys(backing.openCodeModelCatalogCaches)).toHaveLength(20);
    expect(getOpenCodeModelCatalogCache('/project-0')).toBeNull();
    expect(getOpenCodeModelCatalogCache('/project-24')?.models[0].id).toBe('opencode:local/model-24');
  });
});
