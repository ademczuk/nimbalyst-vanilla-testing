// @vitest-environment node
/**
 * Grok's native `ask_user_question` reaching the user.
 *
 * Regressions a reader cannot see by looking at the widget:
 *   - the xAI response schema is keyed by question TEXT and takes an ARRAY for
 *     a multi-select question, while the widget submits one joined string;
 *   - the handler is one application-wide static but questions arrive per
 *     session, so an answer must only settle the session that asked;
 *   - a cancelled turn must settle the pending promise, or Grok sits on an
 *     unanswered ACP request forever.
 */

import { describe, it, expect, vi } from 'vitest';
import type { GrokAskUserQuestionRequest } from '@nimbalyst/runtime/ai/server/protocols/GrokACPProtocol';
import {
  presentGrokAskUserQuestion,
  type GrokAskUserQuestionRuntime,
} from '../grokAskUserQuestionPrompt';

interface Harness {
  runtime: GrokAskUserQuestionRuntime;
  answer: (channel: string, payload: unknown) => boolean;
  toolResults: Array<{ sessionId: string; toolUseId: string; isError?: boolean }>;
}

function createHarness(): Harness {
  const listeners = new Map<string, Array<(event: unknown, payload: any) => void>>();
  const toolResults: Harness['toolResults'] = [];

  return {
    toolResults,
    answer: (channel, payload) => {
      const forChannel = listeners.get(channel) ?? [];
      for (const listener of forChannel) listener(undefined, payload);
      return forChannel.length > 0;
    },
    runtime: {
      persistToolUse: vi.fn(async () => {}),
      persistToolResult: vi.fn(async (args: any) => {
        toolResults.push(args);
      }),
      listRecentMessages: vi.fn(async () => []),
      subscribe: (channel, listener) => {
        const forChannel = listeners.get(channel) ?? [];
        forChannel.push(listener);
        listeners.set(channel, forChannel);
        return () => listeners.set(channel, (listeners.get(channel) ?? []).filter((l) => l !== listener));
      },
      setPendingPrompt: vi.fn(),
      onSettled: vi.fn(),
      // Long enough that neither backstop can settle these tests for us.
      pollIntervalMs: 60_000,
      maxWaitMs: 60_000,
    },
  };
}

function request(overrides: Partial<GrokAskUserQuestionRequest> = {}): GrokAskUserQuestionRequest {
  return {
    sessionId: 'acp-session',
    nimbalystSessionId: 'nim-session',
    toolCallId: 'call-1',
    questions: [{
      question: 'Choose one',
      options: [{ label: 'Alpha', description: 'Alpha' }, { label: 'Beta', description: 'Beta' }],
      multiSelect: null,
    }],
    mode: 'default',
    ...overrides,
  };
}

describe('grok ask_user_question prompt', () => {
  it('answers a multi-select question with an array keyed by question text', async () => {
    const harness = createHarness();
    const pending = presentGrokAskUserQuestion(
      request({
        questions: [{
          question: 'Pick some',
          options: [
            { label: 'Alpha', description: '' },
            { label: 'Beta', description: '' },
            { label: 'Gamma', description: '' },
          ],
          multiSelect: true,
        }],
      }),
      harness.runtime,
    );

    await vi.waitFor(() =>
      expect(harness.answer('ask-user-question-response:nim-session:call-1-question', {
        answers: { 'Pick some': 'Alpha, Gamma' },
        cancelled: false,
      })).toBe(true));

    await expect(pending).resolves.toEqual({
      outcome: 'accepted',
      answers: { 'Pick some': ['Alpha', 'Gamma'] },
      partial_answers: false,
    });
  });

  it('settles only the session that asked when two sessions have questions open', async () => {
    const harness = createHarness();
    const first = presentGrokAskUserQuestion(
      request({ nimbalystSessionId: 'session-a', toolCallId: 'call-a' }),
      harness.runtime,
    );
    const second = presentGrokAskUserQuestion(
      request({ nimbalystSessionId: 'session-b', toolCallId: 'call-b' }),
      harness.runtime,
    );

    let secondSettled = false;
    void second.then(() => { secondSettled = true; });

    await vi.waitFor(() =>
      expect(harness.answer('ask-user-question-response:session-a:call-a-question', {
        answers: { 'Choose one': 'Alpha' },
        cancelled: false,
      })).toBe(true));

    await expect(first).resolves.toMatchObject({
      outcome: 'accepted',
      answers: { 'Choose one': 'Alpha' },
    });
    expect(secondSettled).toBe(false);

    harness.answer('ask-user-question-response:session-b:call-b-question', {
      answers: { 'Choose one': 'Beta' },
      cancelled: false,
    });
    await expect(second).resolves.toMatchObject({ answers: { 'Choose one': 'Beta' } });
  });

  it('settles cancelled when the turn is aborted with the question still open', async () => {
    const harness = createHarness();
    const controller = new AbortController();
    const pending = presentGrokAskUserQuestion(
      request({ signal: controller.signal }),
      harness.runtime,
    );

    await vi.waitFor(() => expect(harness.runtime.persistToolUse).toHaveBeenCalled());
    controller.abort();

    await expect(pending).resolves.toEqual({
      outcome: 'cancelled',
      answers: {},
      partial_answers: false,
    });
    // The widget must not keep offering buttons whose answer has nowhere to go.
    expect(harness.toolResults).toEqual([
      expect.objectContaining({ sessionId: 'nim-session', toolUseId: 'call-1-question', isError: true }),
    ]);
  });

  it('clears the pending prompt even when a dependency rejects', async () => {
    // A rejecting persistence or subscription used to skip terminal cleanup,
    // leaving the session flagged as waiting on a prompt while Grok sat on an
    // open ACP request -- a hung agent process for a failed write.
    for (const failing of ['persistToolResult', 'subscribe'] as const) {
      const harness = createHarness();
      const boom = new Error(`${failing} exploded`);
      if (failing === 'persistToolResult') {
        harness.runtime.persistToolResult = vi.fn(async () => { throw boom; });
      } else {
        harness.runtime.subscribe = vi.fn(() => { throw boom; });
      }

      const pending = presentGrokAskUserQuestion(request(), harness.runtime);
      if (failing === 'persistToolResult') {
        await vi.waitFor(() =>
          expect(harness.answer('ask-user-question-response:nim-session:call-1-question', {
            answers: { 'Choose one': 'Alpha' },
            cancelled: false,
          })).toBe(true));
      }

      await expect(pending).rejects.toThrow(boom);
      expect(harness.runtime.setPendingPrompt).toHaveBeenLastCalledWith('nim-session', false);
      expect(harness.runtime.onSettled).toHaveBeenCalledWith('nim-session', 'call-1-question');
    }
  });
});
