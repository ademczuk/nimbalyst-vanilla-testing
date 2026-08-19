/**
 * Where the web console lives.
 *
 * One authority, for the same reason `collabSyncUrl.ts` is one: an origin
 * re-derived at a call site is an origin that goes stale in exactly one place.
 * Anything that builds a console URL — the "Open the console" action, a
 * pasteable feedback-request link — reads it from here.
 *
 * There is no development variant on purpose. The console is deployed at one
 * origin and the desktop app has no setting that points it anywhere else, so a
 * localhost fallback would be a guess rather than a configuration.
 */
export const CONSOLE_ORIGIN = 'https://console.nimbalyst.com';
