// @vitest-environment node
/**
 * Every enabled provider's catalog must actually be fetched.
 *
 * `getAllModels` used to be an if-per-provider list, and it had silently fallen
 * behind: `grok-build` and `cursor-agent` were both absent. The failure mode is
 * the quiet kind — the provider appears in Settings, its toggle works, it lands
 * in `enabledProviders`, and its model picker is simply empty, with no error
 * logged anywhere. It is now driven off `AI_PROVIDER_TYPES`, and this pins that
 * so a future provider cannot be added to the union and forgotten here.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';

import { ModelRegistry } from '../ModelRegistry';
import { AI_PROVIDER_TYPES, type AIModel, type AIProviderType } from '../types';

type ModelRegistryInternals = {
  fetchFreshModels: (
    provider: AIProviderType,
    workspacePath: string | undefined,
    apiKey: string | undefined,
    baseUrl: string | undefined,
  ) => Promise<AIModel[]>;
};

const registryInternals = ModelRegistry as unknown as ModelRegistryInternals;

afterEach(() => {
  ModelRegistry.clearCache();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ModelRegistry.getAllModels', () => {
  it('fetches a catalog for every provider in the union', async () => {
    const asked: string[] = [];
    vi.spyOn(ModelRegistry, 'getModelsForProvider').mockImplementation(
      async (provider: AIProviderType) => {
        asked.push(provider);
        return [];
      },
    );

    await ModelRegistry.getAllModels({}, undefined);

    expect([...asked].sort()).toEqual([...AI_PROVIDER_TYPES].sort());
  });

  it('fetches only the enabled subset', async () => {
    const asked: string[] = [];
    vi.spyOn(ModelRegistry, 'getModelsForProvider').mockImplementation(
      async (provider: AIProviderType) => {
        asked.push(provider);
        return [];
      },
    );

    await ModelRegistry.getAllModels(
      {},
      undefined,
      new Set<AIProviderType>(['antigravity-gemini-agent', 'grok-build']),
    );

    expect([...asked].sort()).toEqual(['antigravity-gemini-agent', 'grok-build']);
  });

  it('passes each provider the API key it needs, and no key to the ones that have none', async () => {
    const calls = new Map<string, string | undefined>();
    vi.spyOn(ModelRegistry, 'getModelsForProvider').mockImplementation(
      async (provider: AIProviderType, _workspacePath, apiKey) => {
        calls.set(provider, apiKey);
        return [];
      },
    );

    await ModelRegistry.getAllModels({ anthropic: 'sk-ant', openai: 'sk-oai' }, undefined);

    expect(calls.get('claude')).toBe('sk-ant');
    expect(calls.get('openai')).toBe('sk-oai');
    expect(calls.get('openai-codex')).toBe('sk-oai');
    // Vendor-login providers must never be handed a key — the no-env-fallback
    // rule is about where keys come from, and silently passing an unrelated
    // one is the same class of mistake.
    expect(calls.get('antigravity-gemini-agent')).toBeUndefined();
    expect(calls.get('grok-build')).toBeUndefined();
    expect(calls.get('claude-code')).toBeUndefined();
  });
});

describe('ModelRegistry catalog cache', () => {
  const model = (provider: AIProviderType, id: string): AIModel => ({
    id: `${provider}:${id}`,
    name: id,
    provider,
  });

  it('serves an expired catalog immediately while one refresh updates the next read', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T12:00:00Z'));

    const cached = [model('cursor-agent', 'cached')];
    const refreshed = [model('cursor-agent', 'refreshed')];
    let resolveRefresh!: (models: AIModel[]) => void;
    const pendingRefresh = new Promise<AIModel[]>((resolve) => {
      resolveRefresh = resolve;
    });
    const fetchFresh = vi.spyOn(registryInternals, 'fetchFreshModels')
      .mockResolvedValueOnce(cached)
      .mockReturnValueOnce(pendingRefresh);

    expect(await ModelRegistry.getModelsForProvider('cursor-agent', undefined)).toEqual(cached);
    vi.advanceTimersByTime(60 * 60 * 1000 + 1);

    expect(await ModelRegistry.getModelsForProvider('cursor-agent', undefined)).toEqual(cached);
    expect(await ModelRegistry.getModelsForProvider('cursor-agent', undefined)).toEqual(cached);
    expect(fetchFresh).toHaveBeenCalledTimes(2);

    resolveRefresh(refreshed);
    await pendingRefresh;
    await Promise.resolve();

    expect(await ModelRegistry.getModelsForProvider('cursor-agent', undefined)).toEqual(refreshed);
    expect(fetchFresh).toHaveBeenCalledTimes(2);
  });

  it('deduplicates concurrent cold reads for the same provider identity', async () => {
    const discovered = [model('grok-build', 'grok')];
    let resolveRefresh!: (models: AIModel[]) => void;
    const pendingRefresh = new Promise<AIModel[]>((resolve) => {
      resolveRefresh = resolve;
    });
    const fetchFresh = vi.spyOn(registryInternals, 'fetchFreshModels')
      .mockReturnValue(pendingRefresh);

    const first = ModelRegistry.getModelsForProvider('grok-build', undefined);
    const second = ModelRegistry.getModelsForProvider('grok-build', undefined);
    expect(fetchFresh).toHaveBeenCalledTimes(1);

    resolveRefresh(discovered);
    await expect(Promise.all([first, second])).resolves.toEqual([discovered, discovered]);
  });

  it('keeps the stale catalog when a background refresh fails', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T12:00:00Z'));
    const cached = [model('cursor-agent', 'cached')];
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(registryInternals, 'fetchFreshModels')
      .mockResolvedValueOnce(cached)
      .mockRejectedValueOnce(new Error('catalog unavailable'));

    expect(await ModelRegistry.getModelsForProvider('cursor-agent', undefined)).toEqual(cached);
    vi.advanceTimersByTime(60 * 60 * 1000 + 1);
    expect(await ModelRegistry.getModelsForProvider('cursor-agent', undefined)).toEqual(cached);
    await Promise.resolve();
    await Promise.resolve();

    expect(ModelRegistry.getCachedModels('cursor-agent')).toEqual(cached);
  });

  it('isolates OpenCode catalogs by workspace', async () => {
    const fetchFresh = vi.spyOn(registryInternals, 'fetchFreshModels')
      .mockImplementation(async (_provider, workspacePath) => [
        model('opencode', workspacePath ?? 'none'),
      ]);

    const projectA = await ModelRegistry.getModelsForProvider('opencode', '/project-a');
    const projectB = await ModelRegistry.getModelsForProvider('opencode', '/project-b');

    expect(projectA).toEqual([model('opencode', '/project-a')]);
    expect(projectB).toEqual([model('opencode', '/project-b')]);
    expect(await ModelRegistry.getModelsForProvider('opencode', '/project-a')).toEqual(projectA);
    expect(fetchFresh).toHaveBeenCalledTimes(2);
  });

  it('does not serve a catalog fetched with a different API key', async () => {
    const fetchFresh = vi.spyOn(registryInternals, 'fetchFreshModels')
      .mockImplementation(async (provider, _workspacePath, apiKey) => [
        model(provider, apiKey === 'new-key' ? 'new' : 'old'),
      ]);

    expect(await ModelRegistry.getModelsForProvider('openai', undefined, 'old-key'))
      .toEqual([model('openai', 'old')]);
    expect(await ModelRegistry.getModelsForProvider('openai', undefined, 'new-key'))
      .toEqual([model('openai', 'new')]);
    expect(fetchFresh).toHaveBeenCalledTimes(2);
  });
});
