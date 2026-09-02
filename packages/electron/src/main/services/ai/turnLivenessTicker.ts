/**
 * The heartbeat that lets the ambient surfaces tell a working session from a
 * wedged one.
 *
 * The menu bar strip, the island panel and the iOS Live Activity all call a
 * running session "not responding" once it has been silent past
 * `STALL_AFTER_MS`. Silence was measured against the session's last lifecycle
 * transition, and a turn that spends forty minutes inside a single tool call
 * makes none -- so every long turn fell out of Running and stayed out until it
 * finished. Chunks are not a sufficient signal either, for the same reason: a
 * thirty-minute test run yields nothing between the tool call and its result.
 *
 * So the tick is driven by wall clock for as long as the turn is in flight,
 * independent of what the provider is emitting. Its cost is bounded by time
 * rather than by token rate: one in-memory event per minute per running session.
 */

/** One minute. Well inside `STALL_AFTER_MS` (15m), so a tick can be missed. */
export const TURN_LIVENESS_INTERVAL_MS = 60_000;

/**
 * How long a single turn may keep claiming to be alive.
 *
 * A stop that never runs is the one way this makes things *worse* than the bug
 * it fixes: a dead session that keeps ticking is a lie no other surface will
 * ever correct, where a live session that reads as stalled at least self-heals
 * when the turn ends. The stop is in a `finally`, but a provider generator that
 * parks and never resumes reaches neither exit of that block -- the same hole
 * `gitActivityBridge.interruptOutstanding()` documents.
 *
 * This is the backstop for that case, and it is a bound on how long we are
 * willing to lie, not a judgement about how long a turn should take. Past it the
 * session degrades to the old behaviour -- stalled after the usual threshold --
 * which is the correct answer for a turn whose provider has gone away.
 */
export const TURN_LIVENESS_MAX_MS = 4 * 60 * 60_000;

export interface TurnLivenessTickerOptions {
  sessionId: string;
  /** Usually `getSessionStateManager().markTurnAlive`. */
  markAlive: (sessionId: string) => void;
  intervalMs?: number;
  maxDurationMs?: number;
}

/**
 * Start ticking for one turn. Returns the stop, which is idempotent so a
 * terminal path and a `finally` may both call it.
 */
export function startTurnLivenessTicker({
  sessionId,
  markAlive,
  intervalMs = TURN_LIVENESS_INTERVAL_MS,
  maxDurationMs = TURN_LIVENESS_MAX_MS,
}: TurnLivenessTickerOptions): () => void {
  let elapsed = 0;
  let timer: ReturnType<typeof setInterval> | null = setInterval(() => {
    elapsed += intervalMs;
    if (elapsed >= maxDurationMs) {
      stop();
      return;
    }
    try {
      markAlive(sessionId);
    } catch {
      // A heartbeat that throws must not take the turn down with it. There is
      // nothing to report: the only consequence of a missed tick is that the
      // session looks quieter than it is, which is the pre-existing behaviour.
    }
  }, intervalMs);

  // The ticker must never be the reason the process stays up. A turn holding
  // the event loop open past quit would block shutdown for up to a minute.
  timer.unref?.();

  function stop(): void {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  return stop;
}
