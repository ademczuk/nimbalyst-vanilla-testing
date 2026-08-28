// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { createGitRemoteCache } from '../gitRemoteCache';

function harness(results: Record<string, string | null> = {}) {
  let clock = 0;
  const fetch = vi.fn(async (path: string) => results[path] ?? null);
  const cache = createGitRemoteCache(fetch, { ttlMs: 300_000, now: () => clock });
  return { cache, fetch, tick: (ms: number) => { clock += ms; } };
}

describe('createGitRemoteCache', () => {
  it('spawns once per path per TTL, including for non-repos', async () => {
    const h = harness({ '/repo': 'git@github.com:a/b.git' });

    for (let i = 0; i < 20; i++) {
      expect(await h.cache.get('/repo')).toBe('git@github.com:a/b.git');
      // A folder with no origin is the expensive case today: the failed spawn
      // costs the same as a successful one, so null must be cached too.
      expect(await h.cache.get('/not-a-repo')).toBeNull();
    }
    expect(h.fetch).toHaveBeenCalledTimes(2);

    h.tick(300_001);
    await h.cache.get('/repo');
    expect(h.fetch).toHaveBeenCalledTimes(3);
  });

  it('collapses concurrent lookups of one path into a single spawn', async () => {
    // The 46-recent-workspace walk runs concurrently with itself (maxInFlight 4
    // was observed on team:resolve-project-walk), so without single-flight the
    // cache would still let 4 walks each spawn git for the same path.
    const h = harness({ '/repo': 'origin-url' });

    const all = await Promise.all(Array.from({ length: 8 }, () => h.cache.get('/repo')));

    expect(all).toEqual(Array(8).fill('origin-url'));
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not cache a thrown fetch, and re-fetches after invalidate', async () => {
    let clock = 0;
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error('git exploded'))
      .mockResolvedValue('url');
    const cache = createGitRemoteCache(fetch, { ttlMs: 300_000, now: () => clock });

    await expect(cache.get('/repo')).rejects.toThrow('git exploded');
    expect(await cache.get('/repo')).toBe('url');
    expect(fetch).toHaveBeenCalledTimes(2);

    cache.invalidate('/repo');
    expect(await cache.get('/repo')).toBe('url');
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
