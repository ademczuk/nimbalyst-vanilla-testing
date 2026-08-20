import { useEffect, useRef } from 'react';
import { useAtomValue } from 'jotai';

import { teamInboxSnapshotAtom } from '../../store/atoms/teamInbox';
import { unreadDeliveryIdsForConversation } from '../../store/conversationDirectoryViewModel';
import type { InboxProvider } from './Inbox/inboxProvider';

/**
 * Marks the open conversation's inbox deliveries read. Renders nothing.
 *
 * Reading a room is what marks its deliveries read. Only activating an inbox
 * row did that before, so opening #general from the sidebar left its unread
 * pill up forever, and messages arriving while it was on screen kept adding to
 * it. Each delivery is marked once — the set guards against the snapshot churn
 * a mark-read round trip itself produces.
 *
 * It is its own component because it is the window's only consumer of the whole
 * inbox snapshot: subscribing to it from the body meant every delivery, receipt
 * and presence heartbeat re-rendered the entire window, and the mark-read this
 * effect performs fed straight back into that cascade.
 */
export function OrgWindowMarkReadOnOpen({
  orgId,
  conversationId,
  inboxProvider,
}: {
  orgId: string;
  conversationId?: string;
  inboxProvider: InboxProvider;
}) {
  const inboxSnapshot = useAtomValue(teamInboxSnapshotAtom);
  const markedReadRef = useRef<Set<string>>(new Set());
  useEffect(() => { markedReadRef.current = new Set(); }, [orgId]);
  useEffect(() => {
    if (!conversationId) return;
    const pending = unreadDeliveryIdsForConversation(inboxSnapshot, {
      orgId,
      conversationId,
    }).filter((deliveryId) => !markedReadRef.current.has(deliveryId));
    if (pending.length === 0) return;
    for (const deliveryId of pending) markedReadRef.current.add(deliveryId);
    void inboxProvider.markRead(pending).catch(() => {
      // Left unmarked so a later snapshot retries rather than silently
      // dropping the read.
      for (const deliveryId of pending) markedReadRef.current.delete(deliveryId);
    });
  }, [conversationId, inboxProvider, inboxSnapshot, orgId]);
  return null;
}
