import { AnalyticsService } from './AnalyticsService';
import { toStableAnalyticsCategory } from '../../../shared/analytics/eventContract';
import {
  bucketSessionOrdinal,
  initiatorForLaunchSource,
  toSessionLaunchSource,
  validateSessionLaunchEvent,
} from '../../../shared/analytics/sessionLaunch';
import { logger } from '../../utils/logger';

export interface CreateSessionAnalytics {
  provider?: string | null;
  worktreeId?: string | null;
  parentSessionId?: string | null;
  agentRole?: string | null;
  /** Narrowed via `toSessionLaunchSource`, so an unrecognised value degrades to `unknown`. */
  launchSource?: string | null;
  /** Whether the session opened with a draft already in the composer. */
  hadPrefilledPrompt?: boolean;
}

/**
 * The single emitter for `create_ai_session`.
 *
 * Previously there were two, in `SessionHandlers` and `AIService`, with
 * different property sets -- the second omitted `is_meta_agent_session`
 * entirely, so meta-agent sessions created through that path were silently
 * counted as ordinary ones. Consolidating here is what makes the launch
 * context arrive on every creation rather than most of them.
 *
 * Known remaining gap: the mobile worktree path in `AIService` writes through
 * `AISessionsRepository.create` directly and emits nothing at all, so those
 * sessions are invisible in this event. That is pre-existing and tracked
 * separately -- it is why `mobile` is in the launch-source union with no
 * emitter yet.
 */
export function trackCreateAiSession(params: CreateSessionAnalytics): void {
  try {
    const launchSource = toSessionLaunchSource(params.launchSource);
    const ordinal = AnalyticsService.getInstance().nextSessionOrdinal();

    const payload = validateSessionLaunchEvent('create_ai_session', {
      provider: toStableAnalyticsCategory(params.provider),
      is_worktree_session: !!params.worktreeId,
      is_workstream_child: !!params.parentSessionId,
      is_meta_agent_session: params.agentRole === 'meta-agent',
      launchSource,
      initiator: initiatorForLaunchSource(launchSource),
      isFirstEverSession: ordinal === 1,
      sessionOrdinalBucket: bucketSessionOrdinal(ordinal),
      hadPrefilledPrompt: !!params.hadPrefilledPrompt,
    });

    AnalyticsService.getInstance().sendEvent(payload.event, payload.properties);
  } catch (error) {
    // Analytics is best-effort and must never fail a session creation.
    logger.main.warn('[session-launch analytics] Rejected event payload', {
      launchSource: params.launchSource,
      error,
    });
  }
}
