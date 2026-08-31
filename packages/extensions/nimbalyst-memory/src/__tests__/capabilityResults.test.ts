// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  buildOptionalAiUnavailableResult,
  isKeywordOnly,
  isSemanticProviderFailing,
  retrievalKindForOptionalProvider,
} from '../capabilityResults';

describe('optional provider availability results', () => {
  it('selects local sparse retrieval unless a provider was explicitly configured', () => {
    expect(retrievalKindForOptionalProvider(false)).toBe('sparse');
    expect(retrievalKindForOptionalProvider(true)).toBe('openai');
  });

  it('returns a structured manual fallback without soliciting credentials', () => {
    const result = buildOptionalAiUnavailableResult('plans');

    expect(result).toEqual({
      candidates: [],
      sources: [],
      sourceClass: 'plans',
      capability: {
        available: false,
        reason: 'optional-ai-provider-unavailable',
      },
      fallback: {
        used: true,
        kind: 'manual-remember',
        hint: 'Use remember to store durable facts manually.',
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/api key|credential|configure.*settings/i);
  });
});

describe('why semantic matching is off', () => {
  const keywordOnly = {
    mode: 'keyword-only' as const,
    semantic: { available: false },
  };

  it('stays quiet when no provider was ever configured', () => {
    // The sparse embedder reports 0 dims: nothing to reach, nothing to warn about.
    const status = { embedder: { dims: 0 }, retrieval: keywordOnly };
    expect(isKeywordOnly(status)).toBe(true);
    expect(isSemanticProviderFailing(status)).toBe(false);
  });

  it('flags a configured provider that cannot be reached', () => {
    const status = { embedder: { dims: 1536 }, retrieval: keywordOnly };
    expect(isSemanticProviderFailing(status)).toBe(true);
  });

  it('flags nothing while semantic matching is working', () => {
    const status = {
      embedder: { dims: 1536 },
      retrieval: { mode: 'hybrid' as const, semantic: { available: true } },
    };
    expect(isKeywordOnly(status)).toBe(false);
    expect(isSemanticProviderFailing(status)).toBe(false);
  });

  it('treats a missing status as neither keyword-only nor failing', () => {
    expect(isKeywordOnly(undefined)).toBe(false);
    expect(isSemanticProviderFailing(null)).toBe(false);
  });
});
