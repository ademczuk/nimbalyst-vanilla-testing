// @vitest-environment node
import { createStore } from 'jotai';
import { describe, expect, it, vi } from 'vitest';

import type { InboxProvider } from '../Inbox/inboxProvider';
import type { InboxRowView } from '../Inbox/inboxTypes';
import { DEFAULT_INBOX_FILTER } from '../Inbox/inboxTypes';
import { INBOX_FILTERS } from '../Inbox/inboxViewModel';
import {
  DEFAULT_ORG_WINDOW_ROUTE,
  INBOX_ROUTE,
  INBOX_VIEW_ROUTE,
  gateOrgWindowRoute,
  inboxRoute,
  isRouteSelected,
  orgWindowRouteAtomFamily,
  orgWindowRouteKey,
  orgWindowRouteSelectedAtomFamily,
  orgWindowRouteSelectionKey,
  resolveOrgWindowRoute,
  routeForInboxRow,
  withOrgWindowRouting,
} from '../orgWindowState';
import { resolveOrgMessagingGating } from '../orgSidebarViewModel';

function row(overrides: Partial<InboxRowView> = {}): InboxRowView {
  return {
    id: 'delivery-1',
    orgId: 'org-a',
    orgName: 'Acme',
    viewerUserId: 'member-a',
    sourceKind: 'roomMessage',
    sourceId: 'general',
    commentId: 'message-1',
    reasonLabel: 'Mentioned you',
    timestampLabel: '2m',
    unread: true,
    availability: 'available',
    canReply: true,
    createdAt: 1,
    ...overrides,
  } as InboxRowView;
}

function provider(navigate = vi.fn().mockResolvedValue(true)): InboxProvider {
  return {
    getSnapshot: () => ({ status: 'ready', deliveries: [] }),
    subscribe: () => () => {},
    async markRead() {},
    async dismiss() {},
    async migrateOrganization() {},
    navigate,
  };
}

describe('org window routes', () => {
  it('selects on the addressed conversation and admin panel, not just the view', () => {
    const route = { view: 'conversation' as const, conversationId: 'general' };
    expect(isRouteSelected(route, { view: 'conversation', conversationId: 'general' })).toBe(true);
    expect(isRouteSelected(route, { view: 'conversation', conversationId: 'design' })).toBe(false);
    expect(isRouteSelected(route, { view: 'inbox' })).toBe(false);
    expect(isRouteSelected(
      { view: 'admin', adminTab: 'members' },
      { view: 'admin', adminTab: 'projects' },
    )).toBe(false);
  });

  it('keeps navigation isolated between mounted surfaces', () => {
    const store = createStore();
    const windowRoute = orgWindowRouteAtomFamily('window-surface');
    const modeRoute = orgWindowRouteAtomFamily('mode-surface');

    store.set(windowRoute, { view: 'conversation', conversationId: 'general' });

    expect(store.get(windowRoute)).toEqual({
      view: 'conversation',
      conversationId: 'general',
    });
    expect(store.get(modeRoute)).toEqual(DEFAULT_ORG_WINDOW_ROUTE);
    expect(store.get(orgWindowRouteSelectedAtomFamily(
      orgWindowRouteSelectionKey('mode-surface', 'inbox:all'),
    ))).toBe(true);
    expect(store.get(orgWindowRouteSelectedAtomFamily(
      orgWindowRouteSelectionKey('window-surface', 'conversation:general'),
    ))).toBe(true);

    store.set(modeRoute, { view: 'directory' });

    expect(store.get(windowRoute)).toEqual({
      view: 'conversation',
      conversationId: 'general',
    });
    expect(store.get(modeRoute)).toEqual({ view: 'directory' });
  });
});

/**
 * The Inbox is six destinations now, and each sidebar row derives its own
 * selection from the route key. If the key ignored the filter, every Inbox row
 * would light up at once — which is exactly what a bare `'inbox'` key did.
 */
describe('inbox routes', () => {
  it('keys each Inbox row apart, so only one can be selected', () => {
    const keys = INBOX_FILTERS.map(({ id }) => orgWindowRouteKey(inboxRoute(id)));
    expect(new Set(keys).size).toBe(INBOX_FILTERS.length);
    expect(orgWindowRouteKey(inboxRoute('awaiting'))).toBe('inbox:awaiting');
  });

  it('reads a filter-less inbox route as the landing row', () => {
    // Older stored routes and every `{ view: 'inbox' }` call site normalize
    // here rather than matching no row at all.
    expect(orgWindowRouteKey({ view: 'inbox' })).toBe('inbox:all');
    expect(orgWindowRouteKey(INBOX_ROUTE)).toBe('inbox:all');
    expect(isRouteSelected({ view: 'inbox' }, INBOX_ROUTE)).toBe(true);
    expect(isRouteSelected(inboxRoute('mentions'), INBOX_ROUTE)).toBe(false);
    expect(isRouteSelected(inboxRoute('mentions'), inboxRoute('mentions'))).toBe(true);
  });

  it('hands the same route object back per filter, so a memoized row holds', () => {
    expect(inboxRoute('mentions')).toBe(inboxRoute('mentions'));
    expect(inboxRoute(DEFAULT_INBOX_FILTER)).toBe(INBOX_ROUTE);
  });

  it('lets a filter-less destination keep the row already in force', () => {
    // Opening a feedback request answers it in place. Snapping the list to All
    // mid-click would move the row the user just clicked out from under them.
    expect(resolveOrgWindowRoute(inboxRoute('mentions'), INBOX_VIEW_ROUTE))
      .toBe(inboxRoute('mentions'));
    // From anywhere else there is no row to keep, so it lands on the default.
    expect(resolveOrgWindowRoute({ view: 'directory' }, INBOX_VIEW_ROUTE))
      .toBe(INBOX_ROUTE);
    // A named row is always the destination verbatim.
    expect(resolveOrgWindowRoute(inboxRoute('mentions'), inboxRoute('archived')))
      .toBe(inboxRoute('archived'));
  });
});

describe('gateOrgWindowRoute', () => {
  const gating = resolveOrgMessagingGating();

  // Administration is not in this window any more (NIM-2322), so an admin
  // route is redirected regardless of the panel or the viewer's role — a stale
  // hand-off or deep link must land on messaging, not on nothing.
  it.each(['members', 'projects', 'settings', 'billing', 'danger'] as const)(
    'redirects a stale %s route to the messaging landing view',
    (adminTab) => {
      expect(gateOrgWindowRoute({ view: 'admin', adminTab }, gating, []))
        .toEqual(DEFAULT_ORG_WINDOW_ROUTE);
    },
  );

  it('redirects an admin route carrying no panel at all', () => {
    expect(gateOrgWindowRoute({ view: 'admin' }, gating, []))
      .toEqual(DEFAULT_ORG_WINDOW_ROUTE);
  });
});

describe('routeForInboxRow', () => {
  it('routes room and DM deliveries into this window', () => {
    expect(routeForInboxRow(row(), 'org-a'))
      .toEqual({ view: 'conversation', conversationId: 'general' });
    expect(routeForInboxRow(row({ sourceKind: 'dmMessage', sourceId: 'dm-1' }), 'org-a'))
      .toEqual({ view: 'conversation', conversationId: 'dm-1' });
  });

  it('keeps a feedback request in the Inbox it answers from', () => {
    // The respond card is the Inbox's own context pane, so activating one is
    // already where it goes. Routing it out would ask main to re-open this
    // window at the row the user just clicked.
    expect(routeForInboxRow(row({ sourceKind: 'feedbackRequest', sourceId: 'request-1' }), 'org-a'))
      .toEqual({ view: 'inbox' });
  });

  it('leaves anything this window cannot open to the existing deep link', () => {
    // Trackers and documents live in the project window.
    expect(routeForInboxRow(row({ sourceKind: 'trackerComment' }), 'org-a')).toBeNull();
    expect(routeForInboxRow(row({ sourceKind: 'documentDiscussion' }), 'org-a')).toBeNull();
    // Another organization's delivery, and a source the viewer lost access to.
    expect(routeForInboxRow(row(), 'org-b')).toBeNull();
    expect(routeForInboxRow(row({ availability: 'accessRemoved' }), 'org-a')).toBeNull();
  });
});

describe('withOrgWindowRouting', () => {
  it('opens a room delivery in place instead of routing a deep link out', async () => {
    const navigate = vi.fn().mockResolvedValue(true);
    const openRoute = vi.fn();
    const routed = withOrgWindowRouting(provider(navigate), 'org-a', openRoute);

    await expect(routed.navigate(row())).resolves.toBe(true);
    expect(openRoute).toHaveBeenCalledWith({ view: 'conversation', conversationId: 'general' });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('delegates deliveries it cannot open to the wrapped provider', async () => {
    const navigate = vi.fn().mockResolvedValue(false);
    const openRoute = vi.fn();
    const routed = withOrgWindowRouting(provider(navigate), 'org-a', openRoute);

    await expect(routed.navigate(row({ sourceKind: 'trackerComment' }))).resolves.toBe(false);
    expect(openRoute).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});
