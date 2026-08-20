import { useCallback, useEffect, useRef } from 'react';
import { useAtom } from 'jotai';

import type { ConversationDirectoryEntry } from '../../../shared/conversationDirectory';
import type { ConversationDirectoryLoadState } from '../../store/atoms/conversations';
import { refreshConversationDirectory } from '../../store/listeners/conversationDirectoryListeners';
import { isOrgWindowPendingHandoffRoute } from './onboarding/pendingRouteHandoff';
import { useAcknowledgeOrgWindowPendingRoute } from './onboarding/useOrgWindowPendingRoute';
import type { OrgMessagingGating } from './orgSidebarViewModel';
import {
  gateOrgWindowRoute,
  orgWindowRouteAtomFamily,
  resolveOrgWindowRoute,
  routeAfterOrgChange,
  type OrgWindowRoute,
} from './orgWindowState';
import { useRoutedConversation, type RoutedConversation } from './useRoutedConversation';

export interface OrgModeRoute {
  route: OrgWindowRoute;
  onRoute: (route: OrgWindowRoute) => void;
  /** The conversation `route` addresses, once the directory can answer for it. */
  routedConversation: RoutedConversation;
}

/**
 * Owns the surface's route and everything that keeps it legal: an organization
 * change, a destination the organization has turned off, the invite-accept
 * hand-off, and a directory that has not materialized the handed-off room yet.
 */
export function useOrgModeRoute({
  surfaceId,
  orgId,
  gating,
  conversations,
  directoryLoadState,
}: {
  surfaceId: string;
  orgId: string;
  gating: OrgMessagingGating;
  conversations: readonly ConversationDirectoryEntry[];
  directoryLoadState: ConversationDirectoryLoadState;
}): OrgModeRoute {
  // Each mounted surface owns a route-family member. The identity arms do not
  // navigate, and each sidebar row derives selection from this same surface id.
  const [route, setRoute] = useAtom(orgWindowRouteAtomFamily(surfaceId));
  // Folded against the current route so a filter-less Inbox destination keeps
  // the row in force. Functional, so this stays stable across navigations —
  // the memoized sidebar takes it as a prop.
  const onRoute = useCallback((next: OrgWindowRoute) => {
    setRoute((current) => resolveOrgWindowRoute(current, next));
  }, [setRoute]);
  const onboardingDirectoryRetriesRef = useRef(0);

  // A conversation id belongs to exactly one organization. Switching orgs with
  // a room selected would otherwise render "no longer available" against the
  // new org, so the window falls back to its landing view. The exception is the
  // invite-accept / wizard hand-off: when it has already pointed this window at
  // #general, this mount must not undo it and land the new member on Inbox.
  useEffect(() => {
    onRoute(routeAfterOrgChange(orgId, route));
    // Only on an org change: this deliberately does not react to `route`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  // Turning rooms or DMs off while someone is reading one has to move them:
  // the disabled surface is gone from the sidebar and the server would reject
  // a post there anyway. An administration route left over from before
  // NIM-2322 lands here too — this window has no such surface any more.
  useEffect(() => {
    const gated = gateOrgWindowRoute(route, gating, conversations);
    if (gated !== route) onRoute(gated);
  }, [conversations, gating, onRoute, route]);

  const routedConversation = useRoutedConversation(
    orgId,
    route.view === 'conversation' ? route.conversationId : undefined,
    conversations,
    directoryLoadState.status === 'ready'
      || directoryLoadState.status === 'error',
  );
  const activeConversationId = routedConversation.entry?.id;
  const pendingDestination = isOrgWindowPendingHandoffRoute(orgId, route);

  useAcknowledgeOrgWindowPendingRoute(
    orgId,
    route.view === 'conversation' ? route.conversationId : undefined,
    directoryLoadState.status === 'ready'
      && activeConversationId === route.conversationId,
  );

  // A freshly accepted membership can become visible before the TeamRoom's
  // conversation directory has finished materializing #general. Keep the
  // durable hand-off and retry the existing directory read a few times; focus
  // and the sidebar Retry action remain available after the bounded attempts.
  useEffect(() => {
    if (!pendingDestination || activeConversationId === route.conversationId) {
      onboardingDirectoryRetriesRef.current = 0;
      return;
    }
    if (
      directoryLoadState.status === 'idle'
      || directoryLoadState.status === 'loading'
      || onboardingDirectoryRetriesRef.current >= 3
    ) {
      return;
    }
    const attempt = onboardingDirectoryRetriesRef.current++;
    const timeout = window.setTimeout(() => {
      void refreshConversationDirectory(orgId).catch(() => {
        // The load-state error and the sidebar retry affordance remain visible.
      });
    }, 300 * (2 ** attempt));
    return () => window.clearTimeout(timeout);
  }, [
    activeConversationId,
    directoryLoadState.status,
    orgId,
    pendingDestination,
    route.conversationId,
  ]);

  return { route, onRoute, routedConversation };
}
