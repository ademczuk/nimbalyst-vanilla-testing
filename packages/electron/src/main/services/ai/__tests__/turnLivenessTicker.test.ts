// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  TURN_LIVENESS_INTERVAL_MS,
  TURN_LIVENESS_MAX_MS,
  startTurnLivenessTicker,
} from '../turnLivenessTicker';

describe('startTurnLivenessTicker', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reports the turn alive on the interval until it is stopped', () => {
    const markAlive = vi.fn();
    const stop = startTurnLivenessTicker({ sessionId: 's1', markAlive });

    vi.advanceTimersByTime(TURN_LIVENESS_INTERVAL_MS * 3);
    expect(markAlive).toHaveBeenCalledTimes(3);
    expect(markAlive).toHaveBeenLastCalledWith('s1');

    stop();
    vi.advanceTimersByTime(TURN_LIVENESS_INTERVAL_MS * 5);
    expect(markAlive).toHaveBeenCalledTimes(3);
  });

  // The failure mode that would be worse than the bug: a session that keeps
  // claiming to be alive after its turn died is a lie nothing downstream can
  // correct, where a live session mislabelled stalled at least self-heals.
  it('stops when the turn throws, so a dead session cannot keep ticking', () => {
    const markAlive = vi.fn();

    expect(() => {
      const stop = startTurnLivenessTicker({ sessionId: 's1', markAlive });
      try {
        throw new Error('provider stream died');
      } finally {
        stop();
      }
    }).toThrow('provider stream died');

    vi.advanceTimersByTime(TURN_LIVENESS_INTERVAL_MS * 5);
    expect(markAlive).not.toHaveBeenCalled();
  });

  it('is safe to stop twice', () => {
    const stop = startTurnLivenessTicker({ sessionId: 's1', markAlive: vi.fn() });
    stop();
    expect(() => stop()).not.toThrow();
  });

  // A provider generator that parks reaches neither the terminal path nor the
  // finally, so the ticker has to give up on its own.
  it('expires on its own rather than claiming a parked turn is alive forever', () => {
    const markAlive = vi.fn();
    startTurnLivenessTicker({ sessionId: 's1', markAlive });

    vi.advanceTimersByTime(TURN_LIVENESS_MAX_MS * 2);

    const ticksInWindow = TURN_LIVENESS_MAX_MS / TURN_LIVENESS_INTERVAL_MS;
    expect(markAlive.mock.calls.length).toBeLessThan(ticksInWindow);
  });

  it('keeps ticking when a heartbeat throws', () => {
    const markAlive = vi.fn(() => { throw new Error('emit failed'); });
    startTurnLivenessTicker({ sessionId: 's1', markAlive });

    expect(() => vi.advanceTimersByTime(TURN_LIVENESS_INTERVAL_MS * 2)).not.toThrow();
    expect(markAlive).toHaveBeenCalledTimes(2);
  });
});
