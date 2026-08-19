import type { TeamInboxSnapshot, TeamPresenceMember } from '@nimbalyst/runtime/sync';
import { atom } from 'jotai';
import { selectAtom } from 'jotai/utils';

import {
  inboxUnreadCount,
  unreadCountsByConversation,
} from '../../components/TeamMode/orgSidebarViewModel';
import { atomFamily } from '../debug/atomFamilyRegistry';
import { isStructurallyEqual } from '../listeners/atomRevalidation';

export const EMPTY_TEAM_INBOX_SNAPSHOT: TeamInboxSnapshot = {
  status: 'loading',
  deliveries: [],
  organizations: [],
  presence: {},
};

/**
 * Materialized renderer view of every authorized organization inbox.
 *
 * Only the central team-inbox listener writes this atom. Components reach it
 * through the InboxProvider adapter rather than subscribing to IPC.
 */
export const teamInboxSnapshotAtom = atom<TeamInboxSnapshot>(
  EMPTY_TEAM_INBOX_SNAPSHOT,
);

/**
 * One organization's slice of the fan-in, held apart from the snapshot itself.
 *
 * The snapshot carries every authorized organization's deliveries and presence,
 * and it is replaced whenever any of them moves — a presence heartbeat in
 * another organization, or the read receipt this window's own mark-read round
 * trip produces. A window that subscribed to the whole thing rebuilt its
 * sidebar model on each one. These selectors keep their value's identity when
 * the part this organization shows did not change, so nothing downstream is
 * invalidated by another organization's traffic.
 */
export const orgInboxUnreadCountAtomFamily = atomFamily((orgId: string) =>
  selectAtom(
    teamInboxSnapshotAtom,
    (snapshot) => inboxUnreadCount(snapshot, orgId),
  ));

export const orgUnreadCountsByConversationAtomFamily = atomFamily(
  (orgId: string) => selectAtom(
    teamInboxSnapshotAtom,
    (snapshot) => unreadCountsByConversation(snapshot, orgId),
    isStructurallyEqual,
  ),
);

export const orgPresenceAtomFamily = atomFamily((orgId: string) =>
  selectAtom(
    teamInboxSnapshotAtom,
    (snapshot): Readonly<Record<string, TeamPresenceMember>> | undefined =>
      snapshot.presence?.[orgId],
    isStructurallyEqual,
  ));

export const sessionAgentWakePendingAtom = atomFamily((sessionId: string) =>
  selectAtom(
    teamInboxSnapshotAtom,
    (snapshot) => snapshot.deliveries.some((delivery) =>
      !delivery.unavailable
      && delivery.agentSessionIds?.includes(sessionId)
      && !delivery.agentDispatchedSessionIds?.includes(sessionId)),
  ));

export const conversationPendingAgentSessionsAtomFamily = atomFamily(
  (conversationId: string) => selectAtom(
    teamInboxSnapshotAtom,
    (snapshot) => {
      const pending: Record<string, string[]> = {};
      for (const delivery of snapshot.deliveries) {
        if (
          delivery.unavailable
          || !delivery.source
          || !('sourceId' in delivery.source)
          || delivery.source.sourceId !== conversationId
          || !('commentId' in delivery.source)
        ) {
          continue;
        }
        const dispatched = new Set(delivery.agentDispatchedSessionIds ?? []);
        const sessionIds = (delivery.agentSessionIds ?? [])
          .filter((sessionId) => !dispatched.has(sessionId))
          .sort();
        if (sessionIds.length > 0) pending[delivery.source.commentId] = sessionIds;
      }
      return pending;
    },
    isStructurallyEqual,
  ),
);
