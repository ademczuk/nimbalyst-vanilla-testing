import {
  getFeedbackRequestProgress,
  type FeedbackRequest,
  type FeedbackRequestReadModel,
  type FeedbackResponse,
} from '@nimbalyst/collab-protocol';

import type {
  FeedbackRequestServiceState,
  FeedbackRequestServiceTarget,
} from '../../shared/feedbackRequest';
import type {
  AgentWakeCandidate,
  AgentWakePolicyContext,
  AgentWakePolicyRegistry,
} from './AgentMentionDispatchService';

/** Exact key emitted by FeedbackRequestRoom inbox deliveries. */
export const FEEDBACK_REQUEST_WAKE_POLICY_KEY = 'feedbackRequest';

interface FeedbackWakeMetadata {
  requestId?: string;
  trigger?: string;
}

export interface FeedbackRequestWakePolicyDependencies {
  targetFor(
    context: AgentWakePolicyContext,
    candidate: AgentWakeCandidate,
    requestId: string,
  ): Promise<FeedbackRequestServiceTarget | null>;
  loadState(
    target: FeedbackRequestServiceTarget,
  ): Promise<FeedbackRequestServiceState>;
}

function metadataFor(candidate: AgentWakeCandidate): FeedbackWakeMetadata {
  return candidate.policyMetadata ?? {};
}

function hasAttributedResponses(
  request: FeedbackRequestReadModel,
): request is FeedbackRequest {
  return request.responses.every(
    (response): response is FeedbackResponse => (
      typeof response.recipientUserId === 'string'
    ),
  );
}

function quorumReached(state: FeedbackRequestServiceState): boolean {
  const request = state.request;
  if (!request) return false;
  if (hasAttributedResponses(request)) {
    return getFeedbackRequestProgress(request).quorumReached;
  }
  // Hidden results are deliberately anonymous even to the author. In that
  // case the server-projected progress was itself computed with the same
  // protocol helper before attribution was removed.
  return state.progress?.quorumReached === true;
}

export function registerFeedbackRequestWakePolicy(
  registry: AgentWakePolicyRegistry,
  dependencies: FeedbackRequestWakePolicyDependencies,
): () => void {
  return registry.register(
    FEEDBACK_REQUEST_WAKE_POLICY_KEY,
    async (context) => {
      const candidates = context.candidates;
      if (candidates.some((candidate) => metadataFor(candidate).trigger === 'nudge')) {
        return { wake: true, reason: 'explicit feedback request nudge' };
      }
      if (candidates.some((candidate) => {
        const trigger = metadataFor(candidate).trigger;
        return trigger === 'closed' || trigger === 'expired' || trigger === 'cancelled';
      })) {
        return { wake: true, reason: 'feedback request closed' };
      }

      const targets = new Map<string, FeedbackRequestServiceTarget>();
      for (const candidate of candidates) {
        const metadata = metadataFor(candidate);
        if (metadata.trigger !== 'quorum' && metadata.trigger !== 'response') continue;
        if (!metadata.requestId) continue;
        const target = await dependencies.targetFor(
          context,
          candidate,
          metadata.requestId,
        );
        if (target) {
          targets.set(JSON.stringify([
            target.workspacePath,
            target.orgId,
            target.requestId,
          ]), target);
        }
      }

      const states = await Promise.all(
        [...targets.values()].map((target) => dependencies.loadState(target)),
      );
      return states.some(quorumReached)
        ? { wake: true, reason: 'feedback request quorum reached' }
        : { wake: false, reason: 'feedback request awaiting quorum' };
    },
  );
}
