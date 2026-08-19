import React, { useCallback } from 'react';
import { ProviderIcon } from '@nimbalyst/runtime/ui/icons/ProviderIcons';
import { getRelativeTimeString } from '../../utils/dateFormatting';

/**
 * The attention-row layout, with no data dependencies of its own.
 *
 * Two surfaces render it: the in-app `AgentSessionsPopover` (fed from
 * workspace-scoped Jotai atoms) and the menu-bar tray panel (a separate renderer
 * with an empty store, fed from `TrayManager.sessionCache` over IPC). Keeping
 * the markup here is what makes the two look identical by construction rather
 * than by two people remembering to change both.
 *
 * `statusSlot` and `trailingSlot` are the seams: the popover passes its
 * atom-subscribed `SessionStatusIndicator` and transcript-peek button, the panel
 * passes a props-driven indicator and nothing.
 */
export interface SessionAttentionRowProps {
  sessionId: string;
  title: string;
  provider: string;
  /** Provider-qualified model id; the `provider:` prefix is stripped for display. */
  model?: string;
  updatedAt: number;
  /** Workspace label. Only the global tray panel needs it; the popover omits it. */
  workspaceName?: string;
  /** Live status indicator, rendered to the right of the title. */
  statusSlot?: React.ReactNode;
  /** Optional control on the metadata line, right-aligned. */
  trailingSlot?: React.ReactNode;
  onSelect: (sessionId: string) => void;
  /** Receives the row element so callers can anchor a floating element to it. */
  rowRef?: React.MutableRefObject<HTMLDivElement | null>;
}

export function displayModel(model: string | undefined, provider: string): string {
  if (!model) return provider;
  return model.includes(':') ? model.split(':')[1] : model;
}

export function SessionAttentionRow({
  sessionId,
  title,
  provider,
  model,
  updatedAt,
  workspaceName,
  statusSlot,
  trailingSlot,
  onSelect,
  rowRef,
}: SessionAttentionRowProps) {
  const setRef = useCallback((node: HTMLDivElement | null) => {
    if (rowRef) rowRef.current = node;
  }, [rowRef]);

  const resolvedTitle = title || 'Untitled Session';
  const modelLabel = displayModel(model, provider);

  return (
    // Two-row layout mirroring SessionListItem: the title owns the full row width
    // (these surfaces are the only place long generated titles are readable),
    // with metadata demoted to a second line.
    <div
      ref={setRef}
      className="agent-sessions-popover-row flex w-full cursor-pointer items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-nim-tertiary focus-visible:outline-2 focus-visible:outline-[var(--nim-primary)] focus-visible:outline-offset-[-2px]"
      data-session-id={sessionId}
      data-testid={`agent-sessions-row-${sessionId}`}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(sessionId)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(sessionId);
        }
      }}
    >
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded bg-nim-tertiary text-nim-muted">
        <ProviderIcon provider={provider || 'claude'} size={15} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-nim" title={resolvedTitle}>
            {resolvedTitle}
          </span>
          {statusSlot}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-nim-faint">
          <span className="shrink-0 whitespace-nowrap">{getRelativeTimeString(updatedAt)}</span>
          {modelLabel && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{modelLabel}</span>
            </>
          )}
          {workspaceName && (
            <span
              className="agent-sessions-row-workspace ml-1 shrink-0 truncate rounded bg-nim-tertiary px-1.5 py-px text-[10px] text-nim-muted"
              title={workspaceName}
            >
              {workspaceName}
            </span>
          )}
          {trailingSlot && <span className="ml-auto flex shrink-0 items-center">{trailingSlot}</span>}
        </div>
      </div>
    </div>
  );
}
