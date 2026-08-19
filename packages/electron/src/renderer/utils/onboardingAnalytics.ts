import posthog from 'posthog-js';
import type { OnboardingData } from '../components/UnifiedOnboarding/UnifiedOnboarding';

export interface OnboardingAnalyticsClient {
  capture(event: string, properties?: Record<string, unknown>): unknown;
  people: { set(properties: Record<string, unknown>): unknown };
}

/**
 * Referral answers arrive prefixed when the question collects a follow-up
 * ("ai:claude", "search:google"). Cohorts filter on the bare category, so the
 * prefix is split off into a separate detail property rather than shipped as
 * part of the value.
 */
function applyReferralSource(
  target: Record<string, string | boolean>,
  referralSource: string,
): void {
  const prefixes: Array<[string, string]> = [
    ['ai:', 'referral_ai_detail'],
    ['search:', 'referral_search_detail'],
    ['other:', 'referral_other_detail'],
    ['social:', 'referral_social_detail'],
  ];

  for (const [prefix, detailKey] of prefixes) {
    if (referralSource.startsWith(prefix)) {
      target.referral_source = prefix.slice(0, -1);
      target[detailKey] = referralSource.substring(prefix.length);
      return;
    }
  }

  target.referral_source = referralSource;
}

/**
 * Person properties persisted to the user profile. `user_role` and
 * `referral_source` must stay raw enum values so cohorts/insights can filter
 * them with exact match.
 */
export function buildOnboardingPersonProperties(
  data: OnboardingData,
): Record<string, string | boolean> {
  const personProperties: Record<string, string | boolean> = {
    developer_mode: data.developerMode,
  };
  if (data.email) {
    personProperties.email = data.email;
  }
  if (data.role) {
    personProperties.user_role = data.role;
    if (data.customRole) {
      personProperties.custom_role_text = data.customRole;
    }
  }
  if (data.referralSource) {
    applyReferralSource(personProperties, data.referralSource);
  }
  return personProperties;
}

/**
 * Properties for `onboarding_completed`, or null when the user answered neither
 * profile question. The gate is deliberate: the event backs the Devs / Product
 * Managers / role_other cohorts, which are meaningless without role or referral
 * data, and the historical completion-rate baseline was measured with it.
 */
export function buildOnboardingCompletedProperties(
  data: OnboardingData,
): Record<string, string | boolean> | null {
  if (!data.role && !data.referralSource) return null;

  const eventProps: Record<string, string | boolean> = {
    developer_mode: data.developerMode,
    email_provided: !!data.email,
  };
  if (data.role) {
    eventProps.user_role = data.role;
    if (data.customRole) {
      eventProps.custom_role_text = data.customRole;
    }
  }
  if (data.referralSource) {
    applyReferralSource(eventProps, data.referralSource);
  }
  return eventProps;
}

/**
 * Reports a finished onboarding run. Called from `persistOnboardingCompletion`
 * so every completion path — the in-app dialog and the project-manager
 * onboarding-first window — reports identically. Splitting these apart once
 * already cost a release's worth of acquisition data.
 */
export function captureOnboardingCompletion(
  data: OnboardingData,
  client: OnboardingAnalyticsClient = posthog,
): void {
  try {
    client.people.set(buildOnboardingPersonProperties(data));

    const eventProps = buildOnboardingCompletedProperties(data);
    if (eventProps) {
      client.capture('onboarding_completed', eventProps);
    }

    client.capture('developer_mode_changed', {
      developer_mode: data.developerMode,
      source: 'onboarding',
      is_initial: true,
    });
  } catch (error) {
    console.error('[onboarding] Failed to report onboarding analytics:', error);
  }
}
