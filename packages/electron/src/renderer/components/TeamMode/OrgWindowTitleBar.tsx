import React from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';

import { AlphaBadge } from '../common/AlphaBadge';
import { TEAM_BETA_TOOLTIP } from '../common/TeamBetaNotice';

/**
 * The window's title bar: one full-width strip above the rail, the sidebar and
 * the main pane.
 *
 * The org rail used to reserve a 52px spacer for the macOS traffic lights and
 * the sidebar header padded itself when the rail was hidden, which put the
 * lights inside a 64px column and left most of the chrome undraggable. A single
 * strip gives them a row of their own on both layouts and is the window's
 * primary drag handle — every control inside it opts out with
 * `.org-window-no-drag`.
 *
 * It keeps the `org-sidebar-header` marker: the organization name is still the
 * window's identity, it just names the window rather than the sidebar now.
 */
export const OrgWindowTitleBar = React.memo(function OrgWindowTitleBar({
  name,
  onOpenPreferences,
}: {
  name?: string;
  onOpenPreferences?: () => void;
}) {
  return (
    <header
      className="org-window-titlebar org-sidebar-header org-window-drag-region flex shrink-0 items-center gap-2 border-b border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] pr-3"
      data-testid={name ? 'org-sidebar-header' : 'org-window-titlebar'}
      data-component="OrgWindowTitleBar"
      data-window-drag-region="true"
    >
      {/* Unnamed on the arms that have no organization yet: they carry their
          own heading, and the strip is there for the traffic lights. */}
      {name && (
        <>
          <span className="org-sidebar-header-name min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--nim-text)]">
            {name}
          </span>
          <AlphaBadge size="xs" stage="beta" tooltip={TEAM_BETA_TOOLTIP} className="org-window-no-drag shrink-0" />
          {onOpenPreferences && (
            // Inside the drag strip, so it has to opt out by hand or the OS
            // eats the click as a window drag.
            <button
              type="button"
              className="org-window-preferences org-window-no-drag flex size-6 shrink-0 items-center justify-center rounded text-[var(--nim-text-muted)] hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-text)]"
              data-testid="org-window-preferences"
              aria-label="Preferences"
              title="Preferences"
              onClick={onOpenPreferences}
            >
              <MaterialSymbol icon="settings" size={15} />
            </button>
          )}
        </>
      )}
    </header>
  );
});
