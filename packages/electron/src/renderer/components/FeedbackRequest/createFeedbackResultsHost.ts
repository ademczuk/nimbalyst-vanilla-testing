/**
 * The IPC-backed results host.
 *
 * Same split as `createFeedbackRespondHost`: `FeedbackRequestResults` reads
 * atoms and calls host methods, and nothing in it knows an IPC channel name.
 *
 * `nudge` with no recipients is the whole chase story for a hidden request --
 * the wire treats an omitted `recipientUserIds` as "everyone outstanding", so
 * the server can chase people the author is deliberately not shown.
 */

import type { FeedbackRequestLifecycleStatus } from '@nimbalyst/collab-protocol';

import type {
  FeedbackRequestCloseIpcRequest,
  FeedbackRequestNudgeIpcRequest,
  FeedbackRequestServiceTarget,
} from '../../../shared/feedbackRequest';
import type {
  FeedbackResultsActionResult,
  FeedbackResultsHost,
} from './FeedbackRequestResults';

type Invoke = (channel: string, request: unknown) => Promise<unknown>;

export interface FeedbackResultsHostConfig {
  target: FeedbackRequestServiceTarget;
  invoke?: Invoke;
  createMutationId?: () => string;
}

function defaultMutationId(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `feedback-results-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function failure(error: unknown, fallback: string): FeedbackResultsActionResult {
  return {
    success: false,
    error: error instanceof Error ? error.message : fallback,
  };
}

/**
 * Opens (or joins) the request's room so the tab has something to render. The
 * tab container calls this; the component never does, so it stays a reader of
 * atoms.
 */
export async function startFeedbackRequestSync(
  target: FeedbackRequestServiceTarget,
): Promise<void> {
  try {
    await window.electronAPI.feedbackRequest.start(target);
  } catch (error) {
    console.error('[FeedbackRequestResults] Could not open the request room:', error);
  }
}

export function createFeedbackResultsHost(
  config: FeedbackResultsHostConfig,
): FeedbackResultsHost {
  const invoke: Invoke = config.invoke
    ?? ((channel, request) => window.electronAPI.invoke(channel, request));
  const mutationId = config.createMutationId ?? defaultMutationId;

  return {
    async nudge(recipientUserIds?: string[]): Promise<FeedbackResultsActionResult> {
      const request: FeedbackRequestNudgeIpcRequest = {
        target: config.target,
        clientMutationId: mutationId(),
        recipientUserIds,
      };
      try {
        await invoke('feedback-request:nudge', request);
        return { success: true };
      } catch (error) {
        return failure(error, 'The nudge could not be sent.');
      }
    },

    async close(
      status: Exclude<FeedbackRequestLifecycleStatus, 'open' | 'expired'>,
    ): Promise<FeedbackResultsActionResult> {
      const request: FeedbackRequestCloseIpcRequest = {
        target: config.target,
        clientMutationId: mutationId(),
        status,
      };
      try {
        await invoke('feedback-request:close', request);
        return { success: true };
      } catch (error) {
        return failure(
          error,
          status === 'cancelled'
            ? 'The request could not be cancelled.'
            : 'The request could not be closed.',
        );
      }
    },
  };
}
