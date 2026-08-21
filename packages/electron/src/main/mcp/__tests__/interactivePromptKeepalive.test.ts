// @vitest-environment node
//
// #1341: without a heartbeat, Claude Code aborts a pending prompt after 300s
// of server silence ("sent no response or progress for 300s; aborting").

import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  INTERACTIVE_PROMPT_KEEPALIVE_MS,
  extractProgressToken,
  startInteractivePromptKeepalive,
} from '../tools/interactivePromptKeepalive';

function makeRequest(meta?: Record<string, unknown>) {
  return { params: { name: 'AskUserQuestion', arguments: {}, ...(meta ? { _meta: meta } : {}) } };
}

describe('interactive prompt keepalive', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('heartbeats progress on the client token until stopped', () => {
    vi.useFakeTimers();
    const sendNotification = vi.fn();
    const stop = startInteractivePromptKeepalive({
      request: makeRequest({ progressToken: 3, 'claudecode/toolUseId': 'toolu_1' }),
      extra: { sendNotification },
      toolName: 'AskUserQuestion',
    });

    // Comfortably inside the 300s idle window the harness measures.
    vi.advanceTimersByTime(INTERACTIVE_PROMPT_KEEPALIVE_MS * 4);
    expect(sendNotification).toHaveBeenCalledTimes(4);
    expect(sendNotification.mock.calls[0][0]).toMatchObject({
      method: 'notifications/progress',
      params: { progressToken: 3, progress: 1 },
    });
    expect(INTERACTIVE_PROMPT_KEEPALIVE_MS * 5).toBeLessThanOrEqual(300_000);

    stop();
    vi.advanceTimersByTime(INTERACTIVE_PROMPT_KEEPALIVE_MS * 3);
    expect(sendNotification).toHaveBeenCalledTimes(4);
  });

  it('is a no-op when the client sent no progress token', () => {
    vi.useFakeTimers();
    const sendNotification = vi.fn();

    const stop = startInteractivePromptKeepalive({
      request: makeRequest({ 'claudecode/toolUseId': 'toolu_1' }),
      extra: { sendNotification },
      toolName: 'AskUserQuestion',
    });
    vi.advanceTimersByTime(INTERACTIVE_PROMPT_KEEPALIVE_MS * 3);

    expect(sendNotification).not.toHaveBeenCalled();
    expect(() => stop()).not.toThrow();
  });

  it('survives a transport that rejects, so a dead socket cannot cancel the prompt', async () => {
    vi.useFakeTimers();
    const sendNotification = vi.fn().mockRejectedValue(new Error('transport closed'));

    const stop = startInteractivePromptKeepalive({
      request: makeRequest({ progressToken: 'tok' }),
      extra: { sendNotification },
      toolName: 'PromptForUserInput',
    });
    vi.advanceTimersByTime(INTERACTIVE_PROMPT_KEEPALIVE_MS * 2);
    await Promise.resolve();

    expect(sendNotification).toHaveBeenCalledTimes(2);
    stop();
  });

  it('reads the progress token the harness actually sends', () => {
    expect(extractProgressToken(makeRequest({ progressToken: 3 }))).toBe(3);
    expect(extractProgressToken(makeRequest({ progressToken: 'abc' }))).toBe('abc');
    expect(extractProgressToken(makeRequest())).toBeUndefined();
    expect(extractProgressToken(undefined)).toBeUndefined();
  });
});
