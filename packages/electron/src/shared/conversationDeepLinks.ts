export interface ConversationDeepLink {
  orgId: string;
  conversationId: string;
  messageId: string | null;
}

export function buildConversationDeepLink(
  orgId: string,
  conversationId: string,
  messageId?: string | null,
): string {
  const messagePath = messageId
    ? `/message/${encodeURIComponent(messageId)}`
    : '';
  const url = new URL(
    `nimbalyst://conversation/${encodeURIComponent(conversationId)}${messagePath}`,
  );
  url.searchParams.set('orgId', orgId);
  return url.toString();
}

export function parseConversationDeepLink(rawUrl: string): ConversationDeepLink {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'nimbalyst:' || parsed.host !== 'conversation') {
    throw new Error('Not a conversation deep link');
  }
  const segments = parsed.pathname.split('/').filter(Boolean);
  const orgId = parsed.searchParams.get('orgId');
  if (!orgId || !segments[0]) throw new Error('Conversation deep link is incomplete');
  if (segments.length > 1 && (segments[1] !== 'message' || !segments[2])) {
    throw new Error('Conversation deep link has an invalid message path');
  }
  return {
    orgId,
    conversationId: decodeURIComponent(segments[0]),
    messageId: segments[2] ? decodeURIComponent(segments[2]) : null,
  };
}
