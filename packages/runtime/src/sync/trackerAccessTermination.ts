/**
 * Why a tracker room stopped talking to this client, when the answer is
 * permanent.
 *
 * The engine's ordinary disconnect handling is optimistic on purpose: a socket
 * that drops is assumed to be a network event and is retried with backoff
 * forever. That assumption is wrong for permanent authorization/account
 * closes, and being wrong about them is the worst-looking failure the surface
 * has -- a revoked member sits on stale rows behind a "reconnecting" chip that
 * will never resolve, because every retry is refused by the same server that
 * just refused the last one.
 *
 * `TeamTrackerRoom` distinguishes these cases in its close code, so the
 * client can too. Codes 4002 and 4003 mirror document-room removal/revocation;
 * 4004 is tracker account deletion and stays distinct from both.
 */

export type TrackerAccessTerminationReason =
  /** The member or account is no longer present in the organization. */
  | 'removed-from-org'
  /** `guardConnection` / the presence heartbeat: org seat kept, project access gone. */
  | 'tracker-access-revoked'
  /**
   * Client-side: no team JWT could be minted at all, so there is nothing to
   * connect with. Not a close code -- the socket never opened.
   */
  | 'signed-out'
  /**
   * Client-side: the session is real but it does not name a member of this
   * org. Distinct from `signed-out` because signing in again does not help,
   * and distinct from `removed-from-org` because it can also be a link to
   * someone else's org that was never yours.
   */
  | 'not-a-member';

export interface TrackerAccessTermination {
  reason: TrackerAccessTerminationReason;
  /** Absent for `signed-out`, which is decided before a socket exists. */
  closeCode?: 4002 | 4003 | 4004;
  message: string;
}

/**
 * Terminal-or-not, from the close frame alone.
 *
 * Returns null for every other code, including 4001 ("Unknown connection"),
 * which the room emits when its own connection map has lost a socket it still
 * holds. That one is genuinely fixed by reconnecting, so it must stay on the
 * retry path.
 */
export function classifyTrackerClose(
  code: number,
  reason: string,
): TrackerAccessTermination | null {
  if (code === 4002) {
    return {
      reason: 'removed-from-org',
      closeCode: 4002,
      message: reason || 'You were removed from this team.',
    };
  }
  if (code === 4003) {
    return {
      reason: 'tracker-access-revoked',
      closeCode: 4003,
      message: reason || 'Your access to this tracker was revoked.',
    };
  }
  if (code === 4004) {
    return {
      reason: 'removed-from-org',
      closeCode: 4004,
      message: reason || 'This account was deleted.',
    };
  }
  return null;
}
