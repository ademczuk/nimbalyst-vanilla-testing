import React from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import { useAtomValue } from 'jotai';

import {
  orgInboxFilterCountAtomFamily,
  orgInboxFilterCountKey,
} from '../../store/atoms/teamInbox';
import type { InboxFilterId } from './Inbox/inboxTypes';
import type { OrgSidebarItem } from './orgSidebarViewModel';
import type { OrgWindowRoute } from './orgWindowState';
import {
  conversationRoute,
  inboxRoute,
  orgWindowRouteKey,
  orgWindowRouteSelectedAtomFamily,
  orgWindowRouteSelectionKey,
} from './orgWindowState';

/**
 * One navigation row, which reads its own selection rather than being told.
 *
 * `orgWindowRouteSelectedAtomFamily` yields a boolean per destination, and a
 * derived boolean that stays false notifies nobody — so a route change wakes
 * only the row being left and the row being entered. Keep every prop stable in
 * the caller, or the memo around it is decorative.
 */
export const OrgSidebarRow = React.memo(function OrgSidebarRow({
  surfaceId,
  className,
  testId,
  icon,
  label,
  badge = 0,
  presenceStatus,
  route,
  onNavigate,
}: {
  surfaceId: string;
  className: string;
  testId: string;
  icon: string;
  label: string;
  badge?: number;
  presenceStatus?: 'online' | 'away' | 'offline';
  route: OrgWindowRoute;
  onNavigate: (route: OrgWindowRoute) => void;
}) {
  const selected = useAtomValue(
    orgWindowRouteSelectedAtomFamily(
      orgWindowRouteSelectionKey(surfaceId, orgWindowRouteKey(route)),
    ),
  );
  return (
    <button
      type="button"
      className={`${className} org-window-no-drag mx-1.5 flex items-center gap-2 rounded-md px-2 py-1 text-left text-[12.5px] ${
        selected
          ? 'bg-nim-selected font-semibold text-nim'
          : badge > 0
            ? 'font-semibold text-nim hover:bg-nim-hover'
            : 'text-nim-muted hover:bg-nim-hover hover:text-nim'
      }`}
      data-testid={testId}
      data-unread={badge > 0 ? 'true' : 'false'}
      aria-current={selected ? 'page' : undefined}
      onClick={() => onNavigate(route)}
    >
      <span
        className={`relative flex size-4 shrink-0 items-center justify-center ${
          selected ? 'text-nim-primary' : 'text-nim-faint'
        }`}
      >
        <MaterialSymbol icon={icon} size={16} fill={selected} />
        {presenceStatus && <PresenceDot status={presenceStatus} />}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge > 0 && (
        <span
          className="org-unread-pill shrink-0 rounded-full bg-nim-primary px-1.5 text-[10px] font-bold leading-4 text-nim-on-primary"
          aria-label={`${badge} unread`}
        >
          {badge}
        </span>
      )}
    </button>
  );
});

/**
 * One Inbox row, carrying its own count.
 *
 * The count is read here rather than handed down for the same reason selection
 * is: `orgInboxFilterCountAtomFamily` yields a number per row, so a delivery
 * that only moves Mentions repaints Mentions instead of the whole column. An
 * organization-less surface has nothing to count and renders unbadged.
 */
export const OrgInboxNavRow = React.memo(function OrgInboxNavRow({
  surfaceId,
  orgId,
  filter,
  testId,
  icon,
  label,
  onNavigate,
}: {
  surfaceId: string;
  orgId?: string;
  filter: InboxFilterId;
  testId: string;
  icon: string;
  label: string;
  onNavigate: (route: OrgWindowRoute) => void;
}) {
  const badge = useAtomValue(
    orgInboxFilterCountAtomFamily(orgInboxFilterCountKey(orgId ?? '', filter)),
  );
  return (
    <OrgSidebarRow
      surfaceId={surfaceId}
      className="org-inbox-item"
      testId={testId}
      icon={icon}
      label={label}
      badge={orgId ? badge : 0}
      route={inboxRoute(filter)}
      onNavigate={onNavigate}
    />
  );
});

/** A room or direct message, addressed by its conversation route. */
export const OrgConversationRow = React.memo(function OrgConversationRow({
  surfaceId,
  item,
  onNavigate,
}: {
  surfaceId: string;
  item: OrgSidebarItem;
  onNavigate: (route: OrgWindowRoute) => void;
}) {
  const room = item.kind === 'orgRoom';
  return (
    <OrgSidebarRow
      surfaceId={surfaceId}
      className={room ? 'org-room-item' : 'org-dm-item'}
      testId={`${room ? 'org-room-item' : 'org-dm-item'}-${item.conversationId}`}
      icon={room ? (item.isPrivate ? 'lock' : 'tag') : 'person'}
      label={item.label}
      badge={item.unreadCount}
      presenceStatus={!room ? item.presenceStatus : undefined}
      route={conversationRoute(item.conversationId)}
      onNavigate={onNavigate}
    />
  );
});

function PresenceDot({ status }: { status: 'online' | 'away' | 'offline' }) {
  const color = status === 'online'
    ? 'bg-nim-success'
    : status === 'away'
      ? 'bg-nim-warning'
      : 'bg-nim-text-disabled';
  return (
    <span
      className={`org-presence-dot absolute -bottom-0.5 -right-0.5 size-2 rounded-full border border-nim ${color}`}
      aria-label={status}
    />
  );
}

/**
 * Shown in place of a section's empty state when the directory read failed — a
 * stale main process or a dropped connection must not read as "this
 * organization has no rooms". Retry runs the same refresh the freshness
 * listener does, so a recovered main process fills the sidebar in.
 */
export function OrgDirectoryLoadError({
  subject,
  testId,
  onRetry,
}: {
  subject: string;
  testId: string;
  onRetry?: () => void;
}) {
  return (
    <div
      className="org-directory-error m-0 flex items-center gap-1.5 px-3 py-1 text-[11px] leading-relaxed text-nim-muted"
      data-testid={testId}
      role="status"
    >
      <MaterialSymbol icon="error" size={12} className="shrink-0" />
      <span className="min-w-0 flex-1">Couldn&rsquo;t load {subject}.</span>
      {onRetry && (
        <button
          type="button"
          className="org-directory-retry org-window-no-drag shrink-0 rounded px-1 text-[11px] text-nim-link hover:bg-nim-hover"
          data-testid={`${testId}-retry`}
          onClick={onRetry}
        >
          Retry
        </button>
      )}
    </div>
  );
}

/** A section's own note: empty state, loading, or "nothing matched the search". */
export function OrgSidebarSectionNote({
  testId,
  className,
  children,
}: {
  testId: string;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <p
      className={`${className} m-0 px-3 py-1 text-[11px] leading-relaxed text-nim-faint`}
      data-testid={testId}
    >
      {children}
    </p>
  );
}
