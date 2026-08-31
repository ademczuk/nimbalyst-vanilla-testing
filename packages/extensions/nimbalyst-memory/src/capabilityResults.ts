export interface OptionalAiUnavailableResult {
  candidates: [];
  sources: [];
  sourceClass: string;
  capability: {
    available: false;
    reason: 'optional-ai-provider-unavailable';
  };
  fallback: {
    used: true;
    kind: 'manual-remember';
    hint: 'Use remember to store durable facts manually.';
  };
}

export function retrievalKindForOptionalProvider(
  explicitlyConfigured: boolean,
): 'openai' | 'sparse' {
  return explicitlyConfigured ? 'openai' : 'sparse';
}

/** Public status subset needed to classify why semantic matching is off. */
export interface RetrievalStatusView {
  embedder?: { dims?: number } | null;
  retrieval?: {
    mode?: 'hybrid' | 'keyword-only';
    semantic?: { available?: boolean };
  };
}

export function isKeywordOnly(status: RetrievalStatusView | null | undefined): boolean {
  return (
    status?.retrieval?.mode === 'keyword-only' || status?.retrieval?.semantic?.available === false
  );
}

/**
 * True when a provider IS configured and semantic matching is still off, i.e.
 * we cannot reach it. A dims-carrying embedder is the tell: the sparse embedder
 * reports 0 dims, so any positive value means the user configured something.
 *
 * This is the only signal left for the broken-key case — the provider's error
 * text is stripped from the public status and survives only in the main log.
 */
export function isSemanticProviderFailing(
  status: RetrievalStatusView | null | undefined,
): boolean {
  return isKeywordOnly(status) && (status?.embedder?.dims ?? 0) > 0;
}

export function buildOptionalAiUnavailableResult(
  sourceClass: string,
): OptionalAiUnavailableResult {
  return {
    candidates: [],
    sources: [],
    sourceClass,
    capability: {
      available: false,
      reason: 'optional-ai-provider-unavailable',
    },
    fallback: {
      used: true,
      kind: 'manual-remember',
      hint: 'Use remember to store durable facts manually.',
    },
  };
}
