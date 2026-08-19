/**
 * "Record this sign-in exactly once" arbitration for the renderer.
 *
 * `stytch:auth-state-changed` is broadcast to every project window, so every
 * window sees the same signed-out -> signed-in transition and would record the
 * same funnel event. The renderer used to settle that with `document.hasFocus()`,
 * which is the wrong tool twice over: it is true for EVERY window while the app
 * is the active application (NIM-849, see WindowHandlers `window:is-focused`),
 * and it is false for ALL of them when sign-in completes in an external browser
 * and the app is still in the background -- so the event was duplicated in the
 * first case and lost entirely in the second.
 *
 * Main is the one place that sees all the windows, so the claim lives here and
 * the first caller wins. It is keyed (by user) and expires, so a genuinely
 * separate later sign-in is recorded again rather than being swallowed forever.
 *
 * See nimbalyst-local/plans/simpler-org-signup-flow.md.
 */

import { safeHandle } from '../utils/ipcRegistry';

/**
 * Long enough that every window's copy of one broadcast falls inside it, short
 * enough that signing out and back in later counts as a new sign-in.
 */
const CLAIM_TTL_MS = 5 * 60_000;

const claims = new Map<string, number>();

/**
 * Grant the caller the right to record this sign-in, once.
 *
 * Returns true for the first caller for `key` and false for the rest, so the
 * caller that wins is whichever window's broadcast arrived first -- focus, and
 * whether the app is even frontmost, does not enter into it.
 */
export function claimSignInAttribution(key: string, nowMs: number): boolean {
  for (const [existing, claimedAt] of claims) {
    if (nowMs - claimedAt > CLAIM_TTL_MS) claims.delete(existing);
  }
  const claimedAt = claims.get(key);
  if (claimedAt !== undefined && nowMs - claimedAt <= CLAIM_TTL_MS) return false;
  claims.set(key, nowMs);
  return true;
}

/** Test seam: forget every claim. */
export function resetSignInAttributionClaims(): void {
  claims.clear();
}

export function registerSignInAttributionHandlers(): void {
  safeHandle('team:claim-sign-in-attribution', (_event, key?: unknown) => (
    claimSignInAttribution(typeof key === 'string' && key ? key : 'unknown-user', Date.now())
  ));
}
