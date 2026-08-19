/**
 * The IPC-backed respond host.
 *
 * Kept out of the component on purpose: `FeedbackRequestRespond` receives state
 * and calls host methods, and nothing in it knows an IPC channel name. A
 * delivery surface builds one of these and hands it down; a surface that cannot
 * reach the collaboration layer hands down nothing and the card says so.
 *
 * The wire takes one ask at a time (`FeedbackRequestRespondIpcRequest`), so a
 * multi-ask submit is sent in order and stops at the first refusal. Answers
 * already accepted stay accepted -- the server replaces per (recipient, ask) --
 * so a retry re-sends the whole set harmlessly.
 */

import type { FeedbackAnswer } from '@nimbalyst/collab-protocol';

import type {
  FeedbackRequestRespondIpcRequest,
  FeedbackRequestServiceTarget,
} from '../../../shared/feedbackRequest';
import type {
  FeedbackRespondHost,
  FeedbackRespondSubmitResult,
} from './FeedbackRequestRespond';

type Invoke = (channel: string, request: unknown) => Promise<unknown>;

export interface FeedbackRespondHostConfig {
  target: FeedbackRequestServiceTarget;
  invoke?: Invoke;
  createMutationId?: () => string;
}

function defaultMutationId(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `feedback-respond-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createFeedbackRespondHost(
  config: FeedbackRespondHostConfig,
): FeedbackRespondHost {
  const invoke: Invoke = config.invoke
    ?? ((channel, request) => window.electronAPI.invoke(channel, request));
  const mutationId = config.createMutationId ?? defaultMutationId;

  return {
    async submitAnswers(
      answers: Array<{ askId: string; answer: FeedbackAnswer }>,
    ): Promise<FeedbackRespondSubmitResult> {
      for (const { askId, answer } of answers) {
        const request: FeedbackRequestRespondIpcRequest = {
          target: config.target,
          clientMutationId: mutationId(),
          askId,
          answer,
        };
        try {
          await invoke('feedback-request:respond', request);
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error
              ? error.message
              : 'Your answers could not be sent.',
          };
        }
      }
      return { success: true };
    },
  };
}
