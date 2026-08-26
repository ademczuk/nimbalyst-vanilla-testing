import posthog from 'posthog-js';
import {
  validateSendWallEvent,
  type SendWallEventName,
  type SendWallProperties,
} from '../../shared/analytics/sendOutcomes';
import { isAnalyticsConsentGranted } from './analyticsConsent';
import type { RendererAnalyticsClient } from './teamAnalytics';

/**
 * Renderer emitter for the send-wall contract. Validation happens before the
 * capture so a property that is not on the schema throws here rather than
 * shipping; a rejected payload is logged and dropped, never partially sent.
 */
export function captureSendWallEvent<E extends SendWallEventName>(
  client: RendererAnalyticsClient | null | undefined,
  event: E,
  properties: SendWallProperties<E>,
): boolean {
  if (!client) return false;
  // posthog-js `before_send` is the app-wide backstop; checking here as well
  // avoids building a payload the user never consented to us collecting.
  if (!isAnalyticsConsentGranted()) return false;
  try {
    const payload = validateSendWallEvent(event, properties);
    client.capture(payload.event, payload.properties);
    return true;
  } catch (error) {
    console.error('[send-wall analytics] Rejected event payload', { event, error });
    return false;
  }
}

export function trackSendWallEvent<E extends SendWallEventName>(
  event: E,
  properties: SendWallProperties<E>,
): boolean {
  return captureSendWallEvent(posthog, event, properties);
}
