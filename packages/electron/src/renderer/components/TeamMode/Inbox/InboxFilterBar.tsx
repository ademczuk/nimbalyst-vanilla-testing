import React from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';

import { SOURCE_KIND_LABELS, hasScopeChoices, toggleScopeValue, typeIdentity } from './inboxViewModel';
import { InboxScopeMenu } from './InboxScopeMenu';
import type { InboxScope, InboxScopeOptions, InboxSourceKind } from './inboxTypes';

/**
 * The axes the sidebar does not own, all visible, all composable.
 *
 * - **Unread** — its own toggle rather than a reason. Read state was once a
 *   fifth reason chip, which made it mutually exclusive with the reason you
 *   were reading: choosing "Unread" silently threw away "Mentions". "Unread
 *   mentions" is the single most useful triage query on this surface and it was
 *   unexpressible.
 * - **Type** — multi-select chips over the source kinds actually present.
 * - **Scope** — organization and project.
 *
 * The **reason** axis is not here any more: All / Mentions / Assigned to me /
 * Awaiting my reply / Following / Archived are the sidebar's Inbox rows, and
 * each one is a route. A chip and a nav row for the same thing could disagree.
 */
export function InboxFilterBar({
  unreadOnly,
  unreadCount,
  typeCounts,
  scope,
  scopeOptions,
  disabled,
  onUnreadOnlyChange,
  onScopeChange,
}: {
  unreadOnly: boolean;
  unreadCount: number;
  typeCounts: Partial<Record<InboxSourceKind, number>>;
  scope: InboxScope;
  scopeOptions: InboxScopeOptions;
  disabled: boolean;
  onUnreadOnlyChange: (unreadOnly: boolean) => void;
  onScopeChange: (scope: InboxScope) => void;
}) {
  const kinds = scopeOptions.sourceKinds;
  // Same rule the type chips follow below: an axis with nothing to choose
  // between is not rendered at all.
  const showScope = hasScopeChoices(scopeOptions, scope);

  return (
    <div className="inbox-filter-bar flex flex-col gap-2" data-component="InboxFilterBar">
      <div
        className="inbox-filter-reasons flex flex-wrap items-center gap-2"
        data-testid="inbox-filter-bar"
        aria-label="Inbox filters"
      >
        <button
          type="button"
          role="switch"
          disabled={disabled}
          aria-checked={unreadOnly}
          data-testid="inbox-unread-toggle"
          onClick={() => onUnreadOnlyChange(!unreadOnly)}
          className={`inbox-unread-toggle org-window-no-drag flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] ${
            disabled
              ? 'cursor-not-allowed border-[var(--nim-border)] text-[var(--nim-text-disabled)]'
              : unreadOnly
                ? 'border-[var(--nim-primary)] bg-[color-mix(in_srgb,var(--nim-primary)_14%,transparent)] font-medium text-[var(--nim-primary)]'
                : 'border-[var(--nim-border)] text-[var(--nim-text-muted)] hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-text)]'
          }`}
        >
          <MaterialSymbol icon={unreadOnly ? 'toggle_on' : 'toggle_off'} size={16} />
          Unread only
          {unreadCount > 0 && (
            <span className="inbox-unread-toggle-count text-[10px] font-semibold" data-testid="inbox-unread-toggle-count">
              {unreadCount}
            </span>
          )}
        </button>
      </div>

      {kinds.length > 1 && (
        <div className="inbox-filter-types flex flex-wrap items-center gap-1.5" data-testid="inbox-type-filters">
          <span className="inbox-filter-types-label mr-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--nim-text-faint)]">
            Types
          </span>
          {kinds.map((kind) => {
            // An unrestricted axis means every type is showing, so every chip
            // reads as on — the first click has to turn one off, which is what
            // `toggleScopeValue` does.
            const on = !scope.sourceKinds || scope.sourceKinds.includes(kind);
            const identity = typeIdentity(kind);
            const count = typeCounts[kind] ?? 0;
            return (
              <button
                key={kind}
                type="button"
                role="checkbox"
                disabled={disabled}
                aria-checked={on}
                aria-label={SOURCE_KIND_LABELS[kind]}
                data-testid={`inbox-type-filter-${kind}`}
                onClick={() => onScopeChange({
                  ...scope,
                  sourceKinds: toggleScopeValue(scope.sourceKinds, kind, kinds),
                })}
                className={`inbox-type-chip org-window-no-drag flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] ${
                  disabled
                    ? 'cursor-not-allowed border-[var(--nim-border)] text-[var(--nim-text-disabled)]'
                    : on
                      ? 'text-[var(--nim-text)]'
                      : 'border-[var(--nim-border)] text-[var(--nim-text-faint)] hover:bg-[var(--nim-bg-hover)]'
                }`}
                style={on && !disabled ? { borderColor: identity.accent } : undefined}
              >
                <MaterialSymbol
                  icon={identity.icon}
                  size={13}
                  className={on && !disabled ? undefined : 'opacity-60'}
                  style={on && !disabled ? { color: identity.accent } : undefined}
                />
                {SOURCE_KIND_LABELS[kind]}
                {count > 0 && (
                  <span className="inbox-type-chip-count text-[10px] font-semibold text-[var(--nim-text-faint)]">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
          <div className="inbox-filter-bar-spacer ml-auto" />
          {showScope && (
            <InboxScopeMenu scope={scope} options={scopeOptions} disabled={disabled} onChange={onScopeChange} />
          )}
        </div>
      )}

      {kinds.length <= 1 && showScope && (
        <div className="inbox-filter-scope flex items-center">
          <div className="inbox-filter-bar-spacer ml-auto" />
          <InboxScopeMenu scope={scope} options={scopeOptions} disabled={disabled} onChange={onScopeChange} />
        </div>
      )}
    </div>
  );
}
