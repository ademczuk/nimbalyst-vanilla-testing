import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AIModel,
  OpenCodeModelCatalogSnapshot,
} from '../../../../shared/openCodeModelCatalog';

interface OpenCodeModelsSectionProps {
  /** Directory OpenCode discovers providers for; refresh is unavailable without one. */
  workspacePath?: string;
  hiddenModels: string[];
  /** opencode.json `model` value: `provider/model`, without the `opencode:` prefix. */
  selectedModelId: string;
  onSelectModel: (modelId: string) => void;
  onVisibilityToggle: (modelId: string, visible: boolean) => void;
  onSetVisibilityForModels: (modelIds: string[], visible: boolean) => void;
}

interface CatalogStatusCopy {
  tone: 'info' | 'warning';
  headline: string;
  detail: string;
}

/**
 * What the user is looking at, and what to do about it. The cold state matters
 * most: before a first discovery the list is only the built-in fallback, so a
 * user who configured their own providers (OpenRouter, an LM Studio bridge)
 * will not see them until they refresh (#916, #859).
 */
export function describeCatalogStatus(
  snapshot: OpenCodeModelCatalogSnapshot
): CatalogStatusCopy {
  if (snapshot.cacheStatus === 'cold') {
    return {
      tone: 'warning',
      headline: 'Models not discovered yet',
      detail:
        'This is the built-in fallback list. Nimbalyst has not yet asked OpenCode which providers you are signed in to, so providers you configured yourself are missing. Refresh to discover them.',
    };
  }

  if (snapshot.cacheStatus === 'stale' && snapshot.staleReason === 'identity-changed') {
    return {
      tone: 'warning',
      headline: 'Your OpenCode setup changed',
      detail:
        'The OpenCode binary or its credentials changed since this list was discovered, so the fallback list is shown instead. Refresh to rediscover your providers.',
    };
  }

  if (snapshot.cacheStatus === 'stale') {
    return {
      tone: 'warning',
      headline: 'Discovered list may be out of date',
      detail: `Last discovered ${formatTimestamp(snapshot.refreshedAt)}. Refresh to pick up providers or models added since.`,
    };
  }

  return {
    tone: 'info',
    headline: `${countProviders(snapshot.models)} connected ${countProviders(snapshot.models) === 1 ? 'provider' : 'providers'}`,
    detail: `Discovered ${formatTimestamp(snapshot.refreshedAt)} from the providers OpenCode is authenticated for.`,
  };
}

export function useOpenCodeModelCatalog(workspacePath?: string) {
  const [snapshot, setSnapshot] = useState<OpenCodeModelCatalogSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspacePath) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    // Read-only path: it reuses an OpenCode server only if one is already
    // running, so opening settings never spawns `opencode serve`.
    void (async () => {
      try {
        const response = await window.electronAPI.openCodeModelCatalogGet({ workspacePath });
        if (cancelled) return;
        if (response.success) {
          setSnapshot(response.catalog);
          setError(response.catalog.error ?? null);
        } else {
          setError(response.error);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [workspacePath]);

  const refresh = useCallback(async () => {
    if (!workspacePath) return;
    setRefreshing(true);
    setError(null);
    try {
      const response = await window.electronAPI.openCodeModelCatalogRefresh({ workspacePath });
      if (response.success) {
        setSnapshot(response.catalog);
        setError(response.catalog.error ?? null);
      } else {
        setError(response.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }, [workspacePath]);

  return { snapshot, loading, refreshing, error, refresh };
}

export function OpenCodeModelsSection({
  workspacePath,
  hiddenModels,
  selectedModelId,
  onSelectModel,
  onVisibilityToggle,
  onSetVisibilityForModels,
}: OpenCodeModelsSectionProps) {
  const { snapshot, loading, refreshing, error, refresh } = useOpenCodeModelCatalog(workspacePath);
  const [filter, setFilter] = useState('');

  const models = useMemo(() => sortModels(snapshot?.models ?? []), [snapshot]);
  const visibleModels = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return models;
    return models.filter(
      (model) =>
        model.name.toLowerCase().includes(needle) || model.id.toLowerCase().includes(needle)
    );
  }, [models, filter]);

  const status = snapshot ? describeCatalogStatus(snapshot) : null;
  const selectOptions = useMemo(
    () => buildSelectOptions(models, selectedModelId),
    [models, selectedModelId]
  );

  return (
    <div className="opencode-models-section provider-panel-section py-4 mb-4 border-b border-[var(--nim-border)]">
      <div className="flex items-start justify-between gap-3 mb-3">
        <h4 className="provider-panel-section-title text-base font-semibold text-[var(--nim-text)]">Models</h4>
        <div className="flex flex-col items-end gap-1">
          <button
            data-testid="opencode-models-refresh"
            className="inline-flex items-center justify-center py-1.5 px-3 rounded-md text-xs font-medium cursor-pointer transition-all bg-[var(--nim-bg-tertiary)] text-[var(--nim-text)] border border-[var(--nim-border)] hover:bg-[var(--nim-bg-hover)] hover:border-[var(--nim-primary)] disabled:opacity-60 disabled:cursor-not-allowed"
            onClick={() => { void refresh(); }}
            disabled={refreshing || !workspacePath}
          >
            {refreshing ? 'Discovering...' : 'Discover models'}
          </button>
          <span className="text-[11px] text-[var(--nim-text-faint)]">
            {workspacePath
              ? 'Starts OpenCode briefly to read your providers'
              : 'Open a project to discover models'}
          </span>
        </div>
      </div>

      {loading && (
        <p className="text-[13px] text-[var(--nim-text-muted)] py-2">Loading models...</p>
      )}

      {!loading && status && (
        <div
          data-testid="opencode-catalog-status"
          className={`opencode-catalog-status rounded-md px-3 py-2 mb-3 border ${
            status.tone === 'warning'
              ? 'border-[var(--nim-warning)] bg-[var(--nim-bg-secondary)]'
              : 'border-[var(--nim-border)] bg-[var(--nim-bg-secondary)]'
          }`}
        >
          <p className="text-[13px] font-medium text-[var(--nim-text)]">{status.headline}</p>
          <p className="text-xs text-[var(--nim-text-muted)] leading-relaxed mt-1">{status.detail}</p>
        </div>
      )}

      {error && (
        <div className="opencode-catalog-error text-xs mb-3 text-[var(--nim-error)]">
          Discovery failed: {error}
        </div>
      )}

      <label className="block text-[13px] text-[var(--nim-text)] mb-1">Default model</label>
      <p className="text-xs text-[var(--nim-text-muted)] mb-2 leading-relaxed">
        Written to the <code className="text-[var(--nim-code-text)] bg-[var(--nim-code-bg)] px-1 rounded">model</code> field
        of your <code className="text-[var(--nim-code-text)] bg-[var(--nim-code-bg)] px-1 rounded">opencode.json</code>, and used when a session does not pick its own.
      </p>
      <select
        data-testid="opencode-model-select"
        value={selectedModelId}
        onChange={(e) => onSelectModel(e.target.value)}
        className="w-full py-2 px-3 rounded-md bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] text-[var(--nim-text)] outline-none focus:border-[var(--nim-primary)] mb-4"
      >
        <option value="">OpenCode default</option>
        {selectOptions.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>

      {!loading && models.length > 0 && (
        <>
          <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
            <input
              data-testid="opencode-models-filter"
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter models"
              className="flex-1 min-w-[180px] py-1.5 px-3 rounded-md bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] text-[13px] text-[var(--nim-text)] outline-none focus:border-[var(--nim-primary)]"
            />
            <div className="flex gap-2">
              <button
                data-testid="opencode-models-show-all"
                className="text-xs py-1 px-2 rounded bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] text-[var(--nim-text-muted)] hover:text-[var(--nim-text)] hover:bg-[var(--nim-bg-hover)] cursor-pointer transition-all"
                onClick={() => onSetVisibilityForModels(visibleModels.map((m) => m.id), true)}
              >
                Show all
              </button>
              <button
                data-testid="opencode-models-hide-all"
                className="text-xs py-1 px-2 rounded bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] text-[var(--nim-text-muted)] hover:text-[var(--nim-text)] hover:bg-[var(--nim-bg-hover)] cursor-pointer transition-all"
                onClick={() => onSetVisibilityForModels(visibleModels.map((m) => m.id), false)}
              >
                Hide all
              </button>
            </div>
          </div>

          <div className="models-grid flex flex-col gap-1.5">
            {visibleModels.map((model) => {
              const metadata = describeModelMetadata(model);
              return (
              <label
                key={model.id}
                className="opencode-model-row flex items-start gap-3 py-2 px-3 rounded-md bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] cursor-pointer hover:bg-[var(--nim-bg-hover)]"
              >
                <input
                  type="checkbox"
                  checked={!hiddenModels.includes(model.id)}
                  onChange={(e) => onVisibilityToggle(model.id, e.target.checked)}
                  className="w-4 h-4 mt-0.5 cursor-pointer accent-[var(--nim-primary)]"
                />
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-[var(--nim-text)]">{model.name}</span>
                    {model.status && model.status !== 'active' && (
                      <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-muted)]">
                        {model.status}
                      </span>
                    )}
                    {model.unavailable && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--nim-bg-tertiary)] text-[var(--nim-warning)]">
                        provider not connected
                      </span>
                    )}
                  </span>
                  <span className="block text-[11px] text-[var(--nim-text-faint)] font-mono truncate">
                    {stripPrefix(model.id)}
                  </span>
                  {metadata && (
                    <span className="block text-[11px] text-[var(--nim-text-muted)]">
                      {metadata}
                    </span>
                  )}
                </span>
              </label>
              );
            })}
            {visibleModels.length === 0 && (
              <p className="text-[13px] text-[var(--nim-text-muted)] py-2">No models match that filter.</p>
            )}
          </div>
          <p className="text-[11px] text-[var(--nim-text-faint)] leading-relaxed mt-3">
            Unchecked models are hidden from the session model picker. Newly discovered models appear automatically.
          </p>
        </>
      )}

      {!loading && models.length === 0 && (
        <p className="text-[13px] text-[var(--nim-text-muted)] py-2">
          No models yet. Sign in to a provider with{' '}
          <code className="text-[var(--nim-code-text)] bg-[var(--nim-code-bg)] px-1 rounded">opencode auth login</code>,
          then discover models.
        </p>
      )}
    </div>
  );
}

function sortModels(models: AIModel[]): AIModel[] {
  return [...models].sort((a, b) => a.id.localeCompare(b.id));
}

function countProviders(models: AIModel[]): number {
  return new Set(models.map((model) => stripPrefix(model.id).split('/')[0])).size;
}

function stripPrefix(modelId: string): string {
  return modelId.replace(/^opencode:/, '');
}

/**
 * The select carries the id shape opencode.json wants (`provider/model`), and
 * always includes the current selection even when discovery does not know it,
 * so opening settings can never silently drop the configured default.
 */
function buildSelectOptions(
  models: AIModel[],
  selectedModelId: string
): Array<{ value: string; label: string }> {
  const options = models.map((model) => ({
    value: stripPrefix(model.id),
    label: model.unavailable ? `${model.name} (provider not connected)` : model.name,
  }));
  if (selectedModelId && !options.some((option) => option.value === selectedModelId)) {
    options.unshift({ value: selectedModelId, label: `${selectedModelId} (not discovered)` });
  }
  return options;
}

function describeModelMetadata(model: AIModel): string {
  const parts: string[] = [];
  if (model.contextWindow) parts.push(`${formatTokens(model.contextWindow)} context`);
  if (model.cost && (model.cost.input || model.cost.output)) {
    parts.push(`$${formatCost(model.cost.input)} in / $${formatCost(model.cost.output)} out per Mtok`);
  }
  return parts.join('  ·  ');
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}

function formatCost(value: number): string {
  return value >= 1 ? value.toFixed(2) : value.toFixed(3);
}

function formatTimestamp(refreshedAt: number | null): string {
  if (!refreshedAt) return 'never';
  return new Date(refreshedAt).toLocaleString();
}
