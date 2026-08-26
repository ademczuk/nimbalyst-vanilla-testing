// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendEvent = vi.fn();

vi.mock('../AnalyticsService', () => ({
  AnalyticsService: { getInstance: () => ({ sendEvent }) },
}));
vi.mock('../../../utils/logger', () => ({
  logger: { main: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } },
}));

import { trackSendBlocked } from '../sendWallAnalytics';

describe('trackSendBlocked', () => {
  beforeEach(() => sendEvent.mockClear());

  it('emits the validated payload', () => {
    trackSendBlocked('no_api_key', 'anthropic');
    expect(sendEvent).toHaveBeenCalledWith('ai_send_blocked', {
      surface: 'transcript',
      reason: 'no_api_key',
      provider: 'anthropic',
    });
  });

  it('normalizes a provider id rather than passing it through raw', () => {
    trackSendBlocked('no_provider', 'Claude Code CLI');
    expect(sendEvent.mock.calls[0][1].provider).toBe('claude_code_cli');
  });

  it('falls back to unknown when the provider is missing', () => {
    trackSendBlocked('no_workspace');
    expect(sendEvent.mock.calls[0][1].provider).toBe('unknown');
  });

  // This runs inside `MessageStreamingHandler.handle`, directly in the send
  // path. Instrumentation built to diagnose failing sends must never itself be
  // the reason a send fails, so a rejected payload is dropped, not thrown.
  it('never throws into the send path when the payload is rejected', () => {
    expect(() => trackSendBlocked('totally_made_up' as never, '/Users/jane/secret')).not.toThrow();
    expect(sendEvent).not.toHaveBeenCalled();
  });

  it('never throws when the analytics service itself fails', () => {
    sendEvent.mockImplementationOnce(() => {
      throw new Error('posthog client is down');
    });
    expect(() => trackSendBlocked('no_session_id')).not.toThrow();
  });
});
