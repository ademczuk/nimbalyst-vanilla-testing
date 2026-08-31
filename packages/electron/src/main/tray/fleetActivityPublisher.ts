/**
 * What decides when the phone hears from the Mac.
 *
 * The menu bar render is free -- we own the compositor -- so the strip updates
 * as often as it likes. The phone is not: every update is an APNs round trip,
 * and ActivityKit throttles a frequent sender by silently dropping updates,
 * which looks exactly like a bug. So the desktop sends on *transitions* and
 * nothing else, coalesced.
 *
 * The three rules, and each is a separate function so it can be tested without
 * a timer:
 *
 * 1. **Nothing repeats.** A payload that says the same thing as the last one
 *    sent is dropped. `revision` and `updatedAt` change on every derivation and
 *    are deliberately excluded from the comparison -- they are bookkeeping, not
 *    news.
 * 2. **Urgency picks the debounce, not whether to send.** Something new starting
 *    to wait on you is worth a short window; a session finishing is not. Both
 *    windows exist to coalesce a burst (three sessions ending together is one
 *    update), not to rank.
 * 3. **A minimum interval is never bypassed, only queued behind.** An urgent
 *    change inside the window is sent at the end of it rather than dropped,
 *    which is what separates a coalescer from a rate limiter.
 *
 * Plus one thing that is not a transition at all: a heartbeat. A fleet that runs
 * unchanged for half an hour generates no transitions, and without a heartbeat
 * the card would cross its stale date and dim while it was still telling the
 * truth. The heartbeat is what keeps "dimmed" meaning "your Mac is gone".
 */

import { isFleetActive, type FleetActivityPayload, type FleetActivityRow } from './fleetActivity';

/** Coalescing window for an ordinary transition -- a session starting or finishing. */
export const FLEET_PUBLISH_DEBOUNCE_MS = 8_000;

/**
 * Coalescing window for a session that just started waiting on you.
 *
 * Short, because this is the one update the whole surface exists for, but not
 * zero: two sessions blocking a second apart is still one card.
 */
export const FLEET_PUBLISH_URGENT_DEBOUNCE_MS = 1_500;

/** Floor between two sends, whatever happens in between. */
export const FLEET_PUBLISH_MIN_INTERVAL_MS = 15_000;

/**
 * How often an unchanged but non-empty fleet re-sends.
 *
 * Comfortably inside `FLEET_ACTIVITY_STALE_AFTER_MS` so a live desktop never
 * dims, and comfortably outside anything ActivityKit would call frequent.
 */
export const FLEET_PUBLISH_HEARTBEAT_MS = 5 * 60_000;

/** Identity of a row for change detection: who, in what state, since when. */
function rowKey(row: FleetActivityRow): string {
  return `${row.sessionId}:${row.state}:${row.since}`;
}

function rowsKey(rows: FleetActivityRow[]): string {
  return rows.map(rowKey).join('|');
}

/**
 * Whether `next` says anything `prev` did not.
 *
 * Titles are compared through the rows -- a session renamed mid-flight is worth
 * one update, since the card is showing the old name. `updatedAt` and `revision`
 * are not compared at all: they advance on every derivation, so including them
 * would make every tick a transition and defeat the entire module.
 */
export function fleetActivityChanged(
  prev: FleetActivityPayload | null,
  next: FleetActivityPayload,
): boolean {
  if (!prev) return true;
  return (
    prev.running !== next.running ||
    prev.needsApproval !== next.needsApproval ||
    prev.needsDecision !== next.needsDecision ||
    prev.failed !== next.failed ||
    prev.stalled !== next.stalled ||
    prev.unread !== next.unread ||
    prev.overflow !== next.overflow ||
    rowsKey(prev.rows) !== rowsKey(next.rows) ||
    prev.rows.map((row) => row.title).join('|') !== next.rows.map((row) => row.title).join('|')
  );
}

/**
 * Whether the change is one the user would want promptly.
 *
 * Only two things qualify: a session that is now blocked or failed and was not
 * before, and the activity appearing at all. Everything else -- a session
 * starting, a session finishing, a count going down -- is ambient, and ambient
 * news can wait out the long window.
 */
export function isUrgentFleetChange(
  prev: FleetActivityPayload | null,
  next: FleetActivityPayload,
): boolean {
  if (!isFleetActive(next)) return false;
  if (!prev || !isFleetActive(prev)) return true;

  const before = new Set(
    prev.rows.filter((row) => row.state !== 'stalled').map((row) => row.sessionId),
  );
  return next.rows.some((row) => row.state !== 'stalled' && !before.has(row.sessionId));
}

/**
 * How long to wait before sending, given when the last send happened.
 *
 * Never negative, and never less than what the minimum interval still owes.
 */
export function nextPublishDelayMs(options: {
  now: number;
  lastSentAt: number | null;
  urgent: boolean;
}): number {
  const debounce = options.urgent ? FLEET_PUBLISH_URGENT_DEBOUNCE_MS : FLEET_PUBLISH_DEBOUNCE_MS;
  if (options.lastSentAt === null) return debounce;
  const sinceLast = options.now - options.lastSentAt;
  const owed = FLEET_PUBLISH_MIN_INTERVAL_MS - sinceLast;
  return Math.max(debounce, owed);
}

export interface FleetActivityPublisherOptions {
  /** Delivers a payload. Rejections are the caller's to log; the publisher only stops repeating. */
  send: (payload: FleetActivityPayload) => Promise<void> | void;
  /** Injected so tests do not need the real clock to agree with fake timers. */
  now?: () => number;
}

/**
 * Owns the timers around the pure decisions above.
 *
 * `submit` is cheap and safe to call on every derivation -- that is the point.
 * The caller does not decide whether anything is worth sending; it just hands
 * over the current truth.
 */
export class FleetActivityPublisher {
  private readonly send: (payload: FleetActivityPayload) => Promise<void> | void;
  private readonly now: () => number;

  /** The last payload actually handed to `send`, for change detection. */
  private lastSent: FleetActivityPayload | null = null;
  private lastSentAt: number | null = null;
  /** The newest payload submitted but not yet sent. */
  private pending: FleetActivityPayload | null = null;
  private pendingUrgent = false;
  private flushTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(options: FleetActivityPublisherOptions) {
    this.send = options.send;
    this.now = options.now ?? (() => Date.now());
  }

  submit(payload: FleetActivityPayload): void {
    if (this.stopped) return;
    if (!fleetActivityChanged(this.lastSent, payload)) {
      // Back to what the phone already shows. A pending flush would now be a
      // push that says nothing, so it is dropped rather than sent -- coalescing
      // a change and its undo into no update at all is the best outcome
      // available, not a missed one.
      this.pending = null;
      this.pendingUrgent = false;
      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }
      return;
    }

    const urgent = isUrgentFleetChange(this.lastSent, payload);
    this.pending = payload;
    this.pendingUrgent = this.pendingUrgent || urgent;
    this.scheduleFlush();
  }

  /** Every timer released. Safe to call twice. */
  stop(): void {
    this.stopped = true;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.pending = null;
  }

  private scheduleFlush(): void {
    const delay = nextPublishDelayMs({
      now: this.now(),
      lastSentAt: this.lastSentAt,
      urgent: this.pendingUrgent,
    });

    // An urgent change arriving during a long window shortens it; the reverse
    // never lengthens one, or a steady trickle of ambient updates could hold an
    // urgent one back indefinitely.
    if (this.flushTimer) {
      if (!this.pendingUrgent) return;
      clearTimeout(this.flushTimer);
    }

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, delay);
    this.flushTimer.unref?.();
  }

  private async flush(): Promise<void> {
    const payload = this.pending;
    this.pending = null;
    this.pendingUrgent = false;
    if (!payload || this.stopped) return;

    this.lastSent = payload;
    this.lastSentAt = this.now();
    this.scheduleHeartbeat(payload);

    try {
      await this.send(payload);
    } catch {
      // Delivery is the transport's problem to report. Swallowing here is
      // deliberate: a failed send must not stop the next transition being
      // offered, and the phone's own stale date already covers a desktop that
      // has silently stopped being able to send.
    }
  }

  /**
   * Re-send an unchanged fleet before the card would call itself stale.
   *
   * Only while something is actually going on. A quiet fleet has no activity to
   * keep alive, and a heartbeat into a dismissed activity is a wasted push.
   */
  private scheduleHeartbeat(payload: FleetActivityPayload): void {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (!isFleetActive(payload)) return;

    this.heartbeatTimer = setTimeout(() => {
      this.heartbeatTimer = null;
      if (this.stopped || !this.lastSent) return;
      // A real update is already queued, and it is strictly better news than a
      // repeat. Overwriting `pending` here would drop it.
      if (this.pending || this.flushTimer) return;
      // Bypasses `submit`'s change check by construction -- the whole point is
      // that nothing changed. It still goes through `flush`, so the minimum
      // interval and the next heartbeat are both maintained from one place.
      this.pending = { ...this.lastSent, updatedAt: this.now() };
      void this.flush();
    }, FLEET_PUBLISH_HEARTBEAT_MS);
    this.heartbeatTimer.unref?.();
  }
}
