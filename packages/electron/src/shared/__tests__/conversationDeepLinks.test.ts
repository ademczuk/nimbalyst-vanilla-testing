import { describe, expect, it } from 'vitest';
import {
  buildConversationDeepLink,
  parseConversationDeepLink,
} from '../conversationDeepLinks';

describe('conversation deep links', () => {
  it('round-trips the organization, room, and originating message', () => {
    const link = buildConversationDeepLink('org a', 'room/general', 'message 1');

    expect(link).toBe(
      'nimbalyst://conversation/room%2Fgeneral/message/message%201?orgId=org+a',
    );
    expect(parseConversationDeepLink(link)).toEqual({
      orgId: 'org a',
      conversationId: 'room/general',
      messageId: 'message 1',
    });
  });

  it('refuses links without owner-organization routing authority', () => {
    expect(() => parseConversationDeepLink(
      'nimbalyst://conversation/room-a/message/message-a',
    )).toThrow('incomplete');
  });
});
