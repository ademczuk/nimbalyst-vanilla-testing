/**
 * "Which window opens the project walk" arbitration.
 *
 * `stytch:auth-state-changed` is broadcast to every project window, so every
 * window sees the same signed-out -> signed-in transition and would open the
 * same modal. The renderer used to settle that with window focus, which cannot
 * decide it: sign-in finishes in an external browser, so at the moment the
 * broadcast lands NO window is the OS-key window and every window declines. The
 * walk then sat until the user happened to focus the app again -- reported as
 * "after I left and came back, a pop up popped up", by which point they had
 * already given up looking for a way into their organization.
 *
 * Main is the one place that sees all the windows, so the claim lives here and
 * the first caller wins, exactly as `SignInAttribution` does for the funnel
 * event. This one additionally prefers the window that started the sign-in:
 * that window is where the user asked to sign in, so it is where they expect to
 * land, and it is the one worth bringing forward.
 */

import { BrowserWindow } from 'electron';

import { safeHandle } from '../utils/ipcRegistry';
import { logger } from '../utils/logger';

/**
 * Long enough that every window's copy of one broadcast falls inside it, short
 * enough that signing out and back in later gets its own walk.
 */
const CLAIM_TTL_MS = 5 * 60_000;

/**
 * How long the window that started the sign-in gets first refusal. It has to
 * outlast the round trip from the browser back to the app, but not so long that
 * a window which has since been closed strands the walk -- after this, any
 * window may take it.
 */
const ORIGINATOR_GRACE_MS = 2 * 60_000;

const claims = new Map<string, number>();
let originator: { windowId: number; recordedAt: number } | null = null;

/**
 * Note which window started a sign-in flow, so the walk can come back to it.
 */
export function recordProjectWalkOriginator(windowId: number, nowMs: number): void {
  originator = { windowId, recordedAt: nowMs };
}

/**
 * Grant the caller the right to open the walk for `key`, once.
 *
 * Returns true for the first eligible caller and false for the rest. While the
 * originating window's grace period is running it is the only eligible caller;
 * after that any window is, so a sign-in started from a window that has since
 * been closed still lands somewhere.
 */
export function claimProjectWalk(input: {
  key: string;
  windowId: number | null;
  nowMs: number;
}): boolean {
  for (const [existing, claimedAt] of claims) {
    if (input.nowMs - claimedAt > CLAIM_TTL_MS) claims.delete(existing);
  }

  const claimedAt = claims.get(input.key);
  if (claimedAt !== undefined && input.nowMs - claimedAt <= CLAIM_TTL_MS) return false;

  if (
    originator
    && input.nowMs - originator.recordedAt <= ORIGINATOR_GRACE_MS
    && originator.windowId !== input.windowId
  ) {
    return false;
  }

  claims.set(input.key, input.nowMs);
  return true;
}

/** Test seam: forget every claim and any recorded originator. */
export function resetProjectWalkClaims(): void {
  claims.clear();
  originator = null;
}

export function registerProjectWalkClaimHandlers(): void {
  safeHandle('team:claim-project-walk', (event, key?: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const granted = claimProjectWalk({
      key: typeof key === 'string' && key ? key : 'unknown-walk',
      windowId: window?.id ?? null,
      nowMs: Date.now(),
    });

    // The user has just finished signing in inside a browser; handing them back
    // to the window that is about to show the walk is what makes it read as
    // part of sign-in rather than an ambush from a window behind everything.
    if (granted && window && !window.isDestroyed()) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
      logger.main.info('[ProjectWalkClaim] Granted project walk', { windowId: window.id });
    }

    return granted;
  });
}
