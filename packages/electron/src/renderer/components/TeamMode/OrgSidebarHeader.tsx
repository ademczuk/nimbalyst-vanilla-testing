import React from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import { useAtomValue } from 'jotai';

import { FloatingPortal, useFloatingMenu } from '../../hooks/useFloatingMenu';
import { teamInboxSnapshotAtom } from '../../store/atoms/teamInbox';
import type { OrgModeChrome } from './orgModeTypes';
import { orgInitials } from './orgSidebarViewModel';
import { orgConnectionStatus } from './orgWindowRailViewModel';

/**
 * The organization the sidebar is showing — the `WorkspaceSummaryHeader`
 * treatment applied to an org: initials, name, and a live connection line.
 *
 * There is no switcher here by decision: in the project window the organization
 * follows the workspace, so offering to change it would offer to change which
 * project you are in. Reaching a *different* organization is the overflow item,
 * which opens the standalone window — the surface that is allowed to target any
 * org.
 *
 * Memoized, and the connection line subscribes to the inbox snapshot itself:
 * that atom moves on every presence heartbeat, and none of those may repaint the
 * name beside it.
 */
export const OrgSidebarHeader = React.memo(function OrgSidebarHeader({
  orgId,
  orgName,
  chrome,
}: {
  orgId?: string;
  orgName?: string;
  chrome: OrgModeChrome;
}) {
  const menu = useFloatingMenu({ placement: 'bottom-end' });
  const name = orgName?.trim() || 'Organization';

  return (
    <header
      className="org-sidebar-org-header org-window-drag-region flex shrink-0 items-center gap-2 border-b border-nim px-3 py-2.5"
      data-testid="org-sidebar-org-header"
      data-component="OrgSidebarHeader"
      data-org-id={orgId}
    >
      <span
        className="org-sidebar-org-avatar flex size-7 shrink-0 items-center justify-center rounded-lg bg-nim-primary text-[12px] font-bold text-nim-on-primary"
        aria-hidden="true"
      >
        {orgInitials(name)}
      </span>
      <div className="min-w-0 flex-1">
        <h3
          className="org-sidebar-org-name m-0 truncate text-[15px] font-bold leading-tight tracking-tight text-nim"
          title={name}
        >
          {name}
        </h3>
        {orgId && <OrgConnectionLine orgId={orgId} chrome={chrome} />}
      </div>
      {/* The window already switches organizations with its rail, so the way
          out to another one is only offered where there isn't one. */}
      {chrome === 'mode' && (
        <>
          <button
            type="button"
            ref={menu.refs.setReference}
            {...menu.getReferenceProps()}
            className="org-sidebar-org-menu-trigger org-window-no-drag flex size-6 shrink-0 items-center justify-center rounded text-nim-faint hover:bg-nim-hover hover:text-nim"
            data-testid="org-sidebar-org-menu"
            aria-label="Organization actions"
            aria-haspopup="menu"
            aria-expanded={menu.isOpen}
            onClick={() => menu.setIsOpen(!menu.isOpen)}
          >
            <MaterialSymbol icon="more_horiz" size={16} />
          </button>
          {menu.isOpen && (
            <FloatingPortal>
              <div
                ref={menu.refs.setFloating}
                style={menu.floatingStyles}
                {...menu.getFloatingProps()}
                className="org-sidebar-org-menu-panel z-[10000] min-w-[220px] rounded-md border border-nim bg-nim p-1 shadow-lg"
                data-testid="org-sidebar-org-menu-panel"
              >
                <button
                  type="button"
                  className="org-sidebar-open-other-org flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] text-nim hover:bg-nim-hover"
                  data-testid="org-sidebar-open-other-org"
                  onClick={() => {
                    menu.setIsOpen(false);
                    void window.electronAPI?.team?.openManagementWindow?.()
                      .catch((reason: unknown) => {
                        console.error('[OrgSidebarHeader] Failed to open the organization window:', reason);
                      });
                  }}
                >
                  <MaterialSymbol icon="open_in_new" size={16} />
                  Open another organization
                </button>
              </div>
            </FloatingPortal>
          )}
        </>
      )}
    </header>
  );
});

const CONNECTION_LABELS: Record<
  ReturnType<typeof orgConnectionStatus>,
  { label: string; dotClass: string }
> = {
  ready: { label: 'Connected', dotClass: 'bg-nim-success' },
  connecting: { label: 'Connecting…', dotClass: 'bg-nim-warning' },
  offline: { label: 'Offline', dotClass: 'bg-nim-text-disabled' },
  messagingUnavailable: { label: 'Messaging unavailable', dotClass: 'bg-nim-error' },
};

/**
 * Connection state for this organization, plus where the sidebar is hosted —
 * "this project" is the mode's whole scoping story, and it is the line that
 * answers "why can't I see the other organization here".
 */
function OrgConnectionLine({
  orgId,
  chrome,
}: {
  orgId: string;
  chrome: OrgModeChrome;
}) {
  const snapshot = useAtomValue(teamInboxSnapshotAtom);
  const status = orgConnectionStatus(snapshot, orgId);
  const { label, dotClass } = CONNECTION_LABELS[status];
  return (
    <p
      className="org-sidebar-org-connection m-0 mt-0.5 flex items-center gap-1.5 text-[11px] text-nim-faint"
      data-testid="org-sidebar-org-connection"
      data-status={status}
    >
      <span className={`org-sidebar-connection-dot size-[7px] shrink-0 rounded-full ${dotClass}`} aria-hidden="true" />
      <span className="min-w-0 truncate">
        {chrome === 'mode' ? `${label} · this project` : label}
      </span>
    </p>
  );
}
