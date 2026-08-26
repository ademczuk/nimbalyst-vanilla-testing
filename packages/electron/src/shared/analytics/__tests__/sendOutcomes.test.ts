// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  SEND_BLOCKED_REASONS,
  bucketPromptLength,
  validateSendWallEvent,
} from '../sendOutcomes';

describe('send-wall event contract', () => {
  it('accepts every reason in the enum', () => {
    for (const reason of SEND_BLOCKED_REASONS) {
      expect(() =>
        validateSendWallEvent('ai_send_blocked', { surface: 'transcript', reason, provider: 'claude_code' }),
      ).not.toThrow();
    }
  });

  it('rejects a reason outside the enum', () => {
    expect(() =>
      // @ts-expect-error deliberately outside the union
      validateSendWallEvent('ai_send_blocked', { surface: 'transcript', reason: 'because_reasons' }),
    ).toThrow(/not an allowlisted category/);
  });

  it('rejects a property that is not on the schema', () => {
    expect(() =>
      // @ts-expect-error deliberately not on the schema
      validateSendWallEvent('ai_send_blocked', { surface: 'transcript', reason: 'no_api_key', errorText: 'boom' }),
    ).toThrow(/not an allowlisted property/);
  });

  // The reason the enum is closed at all: a raw error message is the easiest
  // way to get a home directory into a payload.
  it.each([
    ['a posix home path', '/Users/jane/projects/secret'],
    ['a linux home path', '/home/jane/notes'],
    ['an email address', 'jane@example.com'],
    ['a url', 'https://internal.corp/thing'],
  ])('rejects %s in a free-form category', (_label, value) => {
    expect(() =>
      validateSendWallEvent('ai_send_blocked', { surface: 'transcript', reason: 'no_provider', provider: value }),
    ).toThrow(/forbidden identifying value|low-cardinality category/);
  });

  it('rejects an unknown event name', () => {
    // @ts-expect-error deliberately unknown
    expect(() => validateSendWallEvent('ai_message_vibed', {})).toThrow(/Unknown analytics event/);
  });
});

describe('prompt length bucketing', () => {
  // `bucketMessageLength` (which stamps ai_message_sent) delegates here, so
  // these boundaries are the shared scale that makes attempted and sent
  // comparable. Not imported from aiServiceUtils on purpose — that module
  // pulls Electron and the AI runtime into a shared-module test.
  it.each([
    [0, 'short'],
    [99, 'short'],
    [100, 'medium'],
    [499, 'medium'],
    [500, 'long'],
  ] as const)('buckets %i as %s', (length, expected) => {
    expect(bucketPromptLength(length)).toBe(expected);
  });
});
