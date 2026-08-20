import { atom } from 'jotai';

import { atomFamily } from '../../store/debug/atomFamilyRegistry';
import type { ConversationDirectoryEntry } from '../../../shared/conversationDirectory';
import { isOrgWindowPendingHandoffRoute } from './onboarding/pendingRouteHandoff';
import type { InboxProvider } from './Inbox/inboxProvider';
import type { InboxFilterId, InboxRowView } from './Inbox/inboxTypes';
import { DEFAULT_INBOX_FILTER } from './Inbox/inboxTypes';
import type { OrgMessagingGating } from './orgSidebarViewModel';

/**
 * Where the organization window is pointed.
 *
 * The window used to hold a local `useState<AdminTab>`, which meant nothing
 * outside the component tree could steer it. Rooms, DMs, the rooms directory
 * and inbox deep links all need to, so selection lives in an atom and is
 * addressed as a route rather than a tab id.
 */
/**
 * `'admin'` is retained as a destination this window *recognizes*, not one it
 * renders: administration moved to the `ORG_MANAGEMENT` dialog (NIM-2322), and
 * an admin route left over from before that — a stale hand-off, a deep link —
 * is redirected to the messaging landing view rather than rendering nothing.
 */
export type OrgWindowView = 'inbox' | 'conversation' | 'directory' | 'admin';

/** The administration panels, which are the management dialog's tabs. */
export type AdminTab =
  | 'members'
  | 'projects'
  | 'settings'
  | 'billing'
  | 'danger';

export interface OrgWindowRoute {
  view: OrgWindowView;
  /** Set when `view` is `'conversation'`. */
  conversationId?: string;
  /** Set when `view` is `'admin'`. */
  adminTab?: AdminTab;
  /**
   * Which Inbox row, when `view` is `'inbox'`.
   *
   * The reason axis is navigation now, not a chip in the list — so it is part
   * of the destination, and the row and the list cannot disagree about which
   * filter is in force. Omitted means *whichever row is already selected*: see
   * `resolveOrgWindowRoute`. A stored route always carries one.
   */
  filter?: InboxFilterId;
}

/**
 * The window opens on the Inbox: it is the section a user lives in, while the
 * rest of the window is rooms they pick and occasional administration.
 *
 * Deliberately its own object rather than `INBOX_ROUTE`, though it addresses
 * the same destination: this value means "nobody has navigated yet", and
 * `isUntouchedOrgWindowRoute` reads that by identity. **Nothing may hand this
 * object back as the result of a navigation or a fallback** — landing on All
 * because the user clicked All, or because a gate bounced them there, is a
 * choice about where they are, and must not read as the absence of one. Use
 * `INBOX_ROUTE` for those; only the atom's initial value is this.
 */
export const DEFAULT_ORG_WINDOW_ROUTE: OrgWindowRoute = {
  view: 'inbox',
  filter: DEFAULT_INBOX_FILTER,
};

/** The two parameterless destinations, as stable values. */
export const INBOX_ROUTE: OrgWindowRoute = {
  view: 'inbox',
  filter: DEFAULT_INBOX_FILTER,
};
export const DIRECTORY_ROUTE: OrgWindowRoute = { view: 'directory' };

/**
 * The Inbox without naming a row — "put me in the Inbox, leave the filter
 * alone". What an in-place action wants: opening a feedback request answers it
 * in the context pane, so it must not re-filter the list out from under the
 * click that opened it.
 */
export const INBOX_VIEW_ROUTE: OrgWindowRoute = { view: 'inbox' };

const INBOX_ROUTES = new Map<InboxFilterId, OrgWindowRoute>([
  [DEFAULT_INBOX_FILTER, INBOX_ROUTE],
]);

/** One Inbox row as a route. Cached per filter, so a memoized row stays memoized. */
export function inboxRoute(filter: InboxFilterId): OrgWindowRoute {
  const cached = INBOX_ROUTES.get(filter);
  if (cached) return cached;
  const route: OrgWindowRoute = { view: 'inbox', filter };
  INBOX_ROUTES.set(filter, route);
  return route;
}

/**
 * Fold a requested destination into where the surface already points.
 *
 * Only `{ view: 'inbox' }` with no filter is affected: it adopts the row in
 * force rather than snapping to All. Everything else — including every route
 * a nav row produces — is the destination verbatim. Returning `current` by
 * identity is what makes "navigate where you already are" a genuine no-op.
 */
export function resolveOrgWindowRoute(
  current: OrgWindowRoute,
  next: OrgWindowRoute,
): OrgWindowRoute {
  if (next.view !== 'inbox' || next.filter !== undefined) return next;
  return current.view === 'inbox' ? current : INBOX_ROUTE;
}

/** The row an inbox route addresses. Never a bare view. */
export function inboxRouteFilter(route: OrgWindowRoute): InboxFilterId {
  return route.filter ?? DEFAULT_INBOX_FILTER;
}

/**
 * The route nothing has pointed anywhere yet, by identity.
 *
 * Only the atom's initial value is this object — a navigation to the same
 * destination produces `INBOX_ROUTE`, and so does every fallback landing — so
 * this is exactly "no navigation has happened", which is the only moment
 * restoring the persisted filter is right rather than overriding a deep link
 * or a row the user just picked.
 */
export function isUntouchedOrgWindowRoute(route: OrgWindowRoute): boolean {
  return route === DEFAULT_ORG_WINDOW_ROUTE;
}

/** Stable identity for the standalone organization window's route state. */
export const ORG_WINDOW_SURFACE_ID = 'org-window';

/**
 * Stable identity for Org mode inside a project window. Deliberately distinct
 * from `ORG_WINDOW_SURFACE_ID`: both surfaces can be mounted at once, and a
 * shared id would let each one navigate the other.
 */
export const PROJECT_ORG_MODE_SURFACE_ID = 'project-org-mode';

/**
 * Route state is scoped to one mounted surface. The standalone window and the
 * project-window mode can therefore stay mounted without steering each other.
 */
export const orgWindowRouteAtomFamily = atomFamily(
  (_surfaceId: string) => atom<OrgWindowRoute>(DEFAULT_ORG_WINDOW_ROUTE),
);

const CONVERSATION_ROUTES = new Map<string, OrgWindowRoute>();

/**
 * Cached per id, so a row that re-renders hands the same route object back and
 * a memoized consumer is not invalidated by the descriptor alone. Routes are
 * read-only value objects; nothing mutates one after it is built.
 */
export function conversationRoute(conversationId: string): OrgWindowRoute {
  const cached = CONVERSATION_ROUTES.get(conversationId);
  if (cached) return cached;
  const route: OrgWindowRoute = { view: 'conversation', conversationId };
  CONVERSATION_ROUTES.set(conversationId, route);
  return route;
}

/**
 * One destination as a comparable string.
 *
 * The sidebar's rows do not need the route — they need to know whether they are
 * the selected one. Deriving a primitive key first is what lets each row
 * subscribe to its own boolean below: a route change then re-renders the two
 * rows whose selection actually flipped instead of the whole window.
 */
export function orgWindowRouteKey(route: OrgWindowRoute): string {
  if (route.view === 'conversation') {
    return `conversation:${route.conversationId ?? ''}`;
  }
  if (route.view === 'admin') return `admin:${route.adminTab ?? ''}`;
  // The Inbox is six destinations, not one. Without the filter in the key every
  // Inbox row would report itself selected at the same time.
  if (route.view === 'inbox') return `inbox:${inboxRouteFilter(route)}`;
  return route.view;
}

/** The active destination's key. A primitive, so equal routes notify nobody. */
export const orgWindowRouteKeyAtomFamily = atomFamily(
  (surfaceId: string) => atom((get) =>
    orgWindowRouteKey(get(orgWindowRouteAtomFamily(surfaceId)))),
);

/**
 * The Inbox row one surface is on, readable and writable as a plain filter id.
 *
 * The list reads this rather than the whole route, so hopping between two rooms
 * does not re-render it, and writing it *is* a navigation — which is the point
 * of the move: there is no second copy of the filter to fall out of step with
 * the sidebar. Off the Inbox entirely it reports the landing row; nothing is
 * rendering the list there.
 */
export const orgWindowInboxFilterAtomFamily = atomFamily((surfaceId: string) => atom(
  (get): InboxFilterId => {
    const route = get(orgWindowRouteAtomFamily(surfaceId));
    return route.view === 'inbox' ? inboxRouteFilter(route) : DEFAULT_INBOX_FILTER;
  },
  (_get, set, filter: InboxFilterId) => {
    set(orgWindowRouteAtomFamily(surfaceId), inboxRoute(filter));
  },
));

/**
 * The unit separator, which cannot occur in a surface id or a route key. `:` is
 * already taken: a conversation's route key is `conversation:<id>`.
 */
const SELECTION_KEY_SEPARATOR = '\x1f';

/**
 * One surface's destination as a single string, so the family below stays a
 * `Map` lookup. An object param would need an `areEqual` comparator, which is
 * what makes `atomFamily` fall back to scanning every member.
 */
export function orgWindowRouteSelectionKey(
  surfaceId: string,
  routeKey: string,
): string {
  return `${surfaceId}${SELECTION_KEY_SEPARATOR}${routeKey}`;
}

/**
 * Whether one destination is the active one. Each sidebar row subscribes to its
 * own instance, so navigating only re-renders the row being left and the row
 * being entered.
 */
export const orgWindowRouteSelectedAtomFamily = atomFamily(
  (selectionKey: string) => {
    const separator = selectionKey.indexOf(SELECTION_KEY_SEPARATOR);
    const surfaceId = selectionKey.slice(0, separator);
    const routeKey = selectionKey.slice(separator + 1);
    return atom((get) =>
      get(orgWindowRouteKeyAtomFamily(surfaceId)) === routeKey);
  },
);

export function isRouteSelected(
  route: OrgWindowRoute,
  candidate: OrgWindowRoute,
): boolean {
  if (route.view !== candidate.view) return false;
  if (candidate.view === 'conversation') {
    return route.conversationId === candidate.conversationId;
  }
  if (candidate.view === 'admin') return route.adminTab === candidate.adminTab;
  // A bare inbox candidate addresses the Inbox generally, so it matches
  // whichever row is in force — the same reading `resolveOrgWindowRoute` uses.
  if (candidate.view === 'inbox' && candidate.filter !== undefined) {
    return inboxRouteFilter(route) === candidate.filter;
  }
  return true;
}

/**
 * Where the window points once its organization changes — which includes the
 * window's first mount.
 *
 * A conversation id belongs to exactly one organization, so a room selected in
 * the old one has to be dropped. The exception is the invite-accept / creation
 * wizard hand-off: it may land either before or after this runs, and when it
 * has already pointed the window at `#general` this must not undo it and send
 * the brand-new member to the Inbox instead.
 */
export function routeAfterOrgChange(
  orgId: string,
  route: OrgWindowRoute,
): OrgWindowRoute {
  if (isOrgWindowPendingHandoffRoute(orgId, route)) return route;
  return route.view === 'conversation' ? INBOX_ROUTE : route;
}

/**
 * Move the window off a destination its organization has turned off, or that
 * this window no longer has.
 *
 * Turning rooms or DMs off while someone is reading one has to land them
 * somewhere, and the Inbox is never gated. A conversation the directory has
 * not loaded yet is left alone — the window's own "loading / no longer
 * available" arm covers it, and bouncing would break deep links that arrive
 * before the listing does.
 *
 * Administration is not gated by role here any more; it is not in this window
 * at all (NIM-2322), so every admin route lands on the messaging default
 * regardless of the viewer's role or which panel was addressed.
 */
export function gateOrgWindowRoute(
  route: OrgWindowRoute,
  gating: OrgMessagingGating,
  conversations: readonly ConversationDirectoryEntry[] = [],
): OrgWindowRoute {
  if (route.view === 'admin') return INBOX_ROUTE;
  if (route.view === 'directory' && !gating.roomsVisible) {
    return INBOX_ROUTE;
  }
  if (route.view === 'conversation') {
    const entry = conversations.find((candidate) => candidate.id === route.conversationId);
    if (!entry) return route;
    if (entry.kind === 'orgRoom' && !gating.roomsVisible) {
      return INBOX_ROUTE;
    }
    if (entry.kind === 'dm' && !gating.dmsVisible) {
      return INBOX_ROUTE;
    }
  }
  return route;
}

/**
 * The in-window destination for an inbox delivery, or null when the delivery
 * belongs somewhere else (a tracker, a document, another organization) and the
 * existing deep-link IPC should keep handling it.
 */
export function routeForInboxRow(
  row: InboxRowView,
  orgId: string,
): OrgWindowRoute | null {
  if (row.orgId !== orgId) return null;
  if (row.availability !== 'available') return null;
  if (!row.sourceId) return null;
  // A feedback request answers in the Inbox's own context pane, so activating
  // one is already where it goes. The filter-less Inbox route keeps it here
  // instead of asking main to re-open this window at the row the user just
  // clicked — and, since the reason axis is navigation now, without yanking the
  // list onto a different row mid-click.
  if (row.sourceKind === 'feedbackRequest') return INBOX_VIEW_ROUTE;
  if (row.sourceKind !== 'roomMessage' && row.sourceKind !== 'dmMessage') {
    return null;
  }
  return conversationRoute(row.sourceId);
}

/**
 * Wrap an inbox provider so activating a room or DM delivery opens that
 * conversation in this window instead of asking the main process to route a
 * deep link out to the project window.
 */
export function withOrgWindowRouting(
  provider: InboxProvider,
  orgId: string,
  openRoute: (route: OrgWindowRoute) => void,
): InboxProvider {
  return {
    ...provider,
    async navigate(row: InboxRowView) {
      const route = routeForInboxRow(row, orgId);
      if (!route) return provider.navigate(row);
      openRoute(route);
      return true;
    },
  };
}
