/**
 * The session-launch contract: how an agent session came to exist.
 *
 * `create_ai_session` has always carried what kind of session was made
 * (provider, worktree, workstream child) and never why or from where. Every
 * launch therefore looks identical in PostHog, which is why the largest step in
 * the activation funnel -- roughly a third of new users landing on "session
 * created, never typed" -- cannot be explained. An empty session the app opened
 * on the user's behalf and one the user deliberately opened and abandoned are
 * indistinguishable, and they mean opposite things.
 *
 * Measured over a 7-day window before this shipped: 18% of `create_ai_session`
 * events fired within 15 seconds of that person's `nimbalyst_session_start`,
 * 25% within 60. So a meaningful slice is launch-adjacent, but "adjacent to
 * launch" is a proxy, not an answer -- `initiator` is the answer.
 *
 * `initiator` is derived from `launchSource` rather than passed alongside it.
 * Two independent fields that must agree are two fields that will eventually
 * disagree, and the disagreement would be invisible in aggregate.
 */

import {
  booleanRule,
  categoryRule,
  enumRule,
  validateAgainstSchemas,
  type PropertiesFor,
} from './eventContract';

/**
 * Every surface that can bring an agent session into existence.
 *
 * Closed on purpose. An unbounded `source` string would be the `database_error`
 * incident again (one session, ~62k events, every one `errorType: unknown`),
 * and a surface name is exactly the kind of value someone would later
 * interpolate a file or workspace name into.
 */
export const SESSION_LAUNCH_SOURCES = [
  // The app decided, not the user
  'app_startup',
  'tab_restore',
  'workstream_convert',

  // The user asked, directly
  'new_session_button',
  'launch_popup',
  'session_history',
  'tray',
  'workspace_welcome',
  'starter_prompt',
  'slash_command',
  'worktree',

  // The user asked, from a feature surface that builds the first prompt
  'commit_flow',
  'issue_panel',
  'pull_request_panel',
  'canvas',

  // An agent or an automated path asked
  'meta_agent',
  'workstream_child',
  'blitz',
  'automation',

  // Off-device origins
  'mobile',
  'cli',

  'unknown',
] as const;
export type SessionLaunchSource = (typeof SESSION_LAUNCH_SOURCES)[number];

/**
 * Who wanted the session. This is the cut the activation funnel actually needs:
 * a session the app opened for someone is not evidence that they tried and gave
 * up, and today both count identically against the 32.8%.
 */
export const SESSION_INITIATORS = ['user', 'app', 'agent'] as const;
export type SessionInitiator = (typeof SESSION_INITIATORS)[number];

/**
 * Single source of truth for the derivation. Exhaustive by type: adding a
 * launch source without deciding who initiated it is a compile error, which is
 * the point -- the default would otherwise silently be `user` and inflate the
 * exact number we are trying to deflate.
 */
const INITIATOR_BY_SOURCE: Record<SessionLaunchSource, SessionInitiator> = {
  app_startup: 'app',
  tab_restore: 'app',
  workstream_convert: 'app',

  new_session_button: 'user',
  launch_popup: 'user',
  session_history: 'user',
  tray: 'user',
  workspace_welcome: 'user',
  starter_prompt: 'user',
  slash_command: 'user',
  worktree: 'user',

  commit_flow: 'user',
  issue_panel: 'user',
  pull_request_panel: 'user',
  canvas: 'user',

  meta_agent: 'agent',
  workstream_child: 'agent',
  blitz: 'agent',
  automation: 'agent',

  mobile: 'user',
  cli: 'user',

  // Deliberately `app`, not `user`. An uninstrumented path is far more likely
  // to be one the app took on its own than a button someone pressed, and the
  // honest failure is to under-count deliberate launches rather than to
  // manufacture them.
  unknown: 'app',
};

export function initiatorForLaunchSource(source: SessionLaunchSource): SessionInitiator {
  return INITIATOR_BY_SOURCE[source] ?? 'app';
}

/** Narrow an untrusted value (it crosses IPC) back onto the union. */
export function toSessionLaunchSource(value: unknown): SessionLaunchSource {
  return (SESSION_LAUNCH_SOURCES as readonly string[]).includes(value as string)
    ? (value as SessionLaunchSource)
    : 'unknown';
}

/**
 * Bucket how many sessions this install has ever created.
 *
 * A raw lifetime count next to an install age is close to a unique key on a
 * small cohort. Session one gets its own bucket because "created exactly one
 * session, ever" is the population the activation work is about.
 */
export function bucketSessionOrdinal(ordinal: number): string {
  if (ordinal <= 1) return '1';
  if (ordinal <= 4) return '2-4';
  if (ordinal <= 9) return '5-9';
  return '10+';
}

export const SESSION_LAUNCH_EVENT_SCHEMAS = {
  create_ai_session: {
    // Pre-existing properties, brought under the contract so a future edit to
    // this event cannot bypass the privacy guard by adding a field here.
    provider: categoryRule,
    is_worktree_session: booleanRule,
    is_workstream_child: booleanRule,
    is_meta_agent_session: booleanRule,

    // New in this change.
    launchSource: enumRule(...SESSION_LAUNCH_SOURCES),
    initiator: enumRule(...SESSION_INITIATORS),
    isFirstEverSession: booleanRule,
    sessionOrdinalBucket: categoryRule,
    hadPrefilledPrompt: booleanRule,
  },
} as const;

type SchemaMap = typeof SESSION_LAUNCH_EVENT_SCHEMAS;
export type SessionLaunchEventName = keyof SchemaMap & string;
export type SessionLaunchProperties<E extends SessionLaunchEventName> = PropertiesFor<SchemaMap, E>;

export function validateSessionLaunchEvent<E extends SessionLaunchEventName>(
  event: E,
  properties: SessionLaunchProperties<E>,
): { event: E; properties: SessionLaunchProperties<E> } {
  return validateAgainstSchemas(SESSION_LAUNCH_EVENT_SCHEMAS, event, properties);
}
