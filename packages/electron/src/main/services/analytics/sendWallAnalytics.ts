import { AnalyticsService } from './AnalyticsService';
import {
  toStableAnalyticsCategory,
  validateSendWallEvent,
  type SendBlockedReason,
} from '../../../shared/analytics/sendOutcomes';
import { logger } from '../../utils/logger';

/**
 * Main-process emitter for the send-wall contract.
 *
 * Ownership rule: the process that *decides* a send is refused is the process
 * that reports it. Everything downstream of `ai:sendMessage` is decided here,
 * so the renderer's catch deliberately stays silent rather than emitting a
 * generic `ipc_error` alongside this — double-counting a block would push the
 * `attempted - blocked - sent` residue negative and make it useless as the
 * "some path is uninstrumented" signal it exists to be.
 *
 * A genuine transport failure, where main never ran at all, is therefore
 * uncounted by design and shows up in that residue.
 */
export function trackSendBlocked(reason: SendBlockedReason, provider?: string): void {
  try {
    const payload = validateSendWallEvent('ai_send_blocked', {
      surface: 'transcript',
      reason,
      provider: toStableAnalyticsCategory(provider),
    });
    AnalyticsService.getInstance().sendEvent(payload.event, payload.properties);
  } catch (error) {
    // Analytics is best-effort and must never block or fail a send.
    logger.main.warn('[send-wall analytics] Rejected event payload', { reason, error });
  }
}
