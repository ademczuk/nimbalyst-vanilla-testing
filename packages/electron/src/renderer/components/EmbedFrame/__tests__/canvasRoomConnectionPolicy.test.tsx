/**
 * The shared-card room ceiling, and the one way it silently stops being a
 * ceiling.
 *
 * Room release is asynchronous by construction: a card confirms its socket is
 * gone only after `CollaborativeEmbedProviderCache.acquire` settles, which can
 * be long after the card swapped to a different document and took out a
 * different lease. A miscredited release is invisible at runtime -- nothing
 * throws, nothing renders wrong, the active count just drifts -- and the drift
 * is what makes "16 sockets for 10 shared cards" stop being true.
 *
 * The second case is the preempt-and-re-grant cycle, which is the only path
 * where a holder leaves the active set and comes back. It is the arithmetic
 * most likely to be broken by a future edit to `pump` / `preemptForHot`, and
 * equally silent when it is.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  CANVAS_SHARED_ROOM_LIMIT,
  getCanvasRoomPolicySnapshot,
  useCanvasRoomConnectionLease,
} from '../canvasRoomConnectionPolicy';

/** One card's lease, keyed on the room it wants. */
function renderLease(key: string) {
  return renderHook(
    ({ leaseKey, priority }: { leaseKey: string; priority: 'warm' | 'hot' }) =>
      useCanvasRoomConnectionLease(leaseKey, priority, true),
    { initialProps: { leaseKey: key, priority: 'warm' as const } },
  );
}

describe('canvas shared-room lease', () => {
  it('credits a late release to the lease that held it, not the one that replaced it', () => {
    const before = getCanvasRoomPolicySnapshot().active;
    const card = renderLease('room-a');
    expect(getCanvasRoomPolicySnapshot().active).toBe(before + 1);

    // The card's reference changed. `room-a` is now `releasing` -- still
    // occupying its slot -- while `room-b` has been granted a second one.
    const releaseRoomA = card.result.current.acknowledgeConnectionReleased;
    act(() => {
      card.rerender({ leaseKey: 'room-b', priority: 'warm' });
    });
    expect(getCanvasRoomPolicySnapshot().active).toBe(before + 2);

    // `room-a`'s provider finally lets go. Acknowledging the *current* lease
    // here would leave `room-a` in `releasing` forever: the ceiling would be
    // one slot smaller for the rest of the session, for every card that ever
    // changed which document it points at.
    act(() => {
      releaseRoomA();
    });
    expect(getCanvasRoomPolicySnapshot().active).toBe(before + 1);

    act(() => {
      const releaseRoomB = card.result.current.acknowledgeConnectionReleased;
      card.unmount();
      releaseRoomB();
    });
    expect(getCanvasRoomPolicySnapshot().active).toBe(before);
  });

  it('holds the ceiling exactly across a preempt-and-re-grant cycle', () => {
    // Fill the ceiling with warm cards, then let a hot one preempt the oldest.
    const warm = Array.from({ length: CANVAS_SHARED_ROOM_LIMIT }, (_, index) =>
      renderLease(`warm-${index}`),
    );
    expect(getCanvasRoomPolicySnapshot().active).toBe(CANVAS_SHARED_ROOM_LIMIT);

    const victimRelease = warm[0].result.current.acknowledgeConnectionReleased;
    const hot = renderHook(() =>
      useCanvasRoomConnectionLease('hot-room', 'hot', true),
    );
    expect(warm[0].result.current.granted).toBe(false);

    // The evicted card's socket closes, so its slot passes to the hot card and
    // the evicted card goes back on the queue. The count must not move: one
    // room left, one room arrived.
    act(() => {
      victimRelease();
    });
    expect(getCanvasRoomPolicySnapshot().active).toBe(CANVAS_SHARED_ROOM_LIMIT);

    act(() => {
      hot.result.current.acknowledgeConnectionReleased();
      hot.unmount();
    });
    // The re-queued card is back in a slot.
    expect(getCanvasRoomPolicySnapshot().active).toBe(CANVAS_SHARED_ROOM_LIMIT);
    expect(warm[0].result.current.granted).toBe(true);

    // Releasing it holds the slot until its socket confirms, exactly as a
    // first-time grant does -- a re-granted holder is not a special case.
    act(() => {
      warm[0].unmount();
    });
    expect(getCanvasRoomPolicySnapshot().active).toBe(CANVAS_SHARED_ROOM_LIMIT);

    act(() => {
      warm[0].result.current.acknowledgeConnectionReleased();
    });
    expect(getCanvasRoomPolicySnapshot().active).toBe(
      CANVAS_SHARED_ROOM_LIMIT - 1,
    );

    for (const card of warm.slice(1)) {
      const release = card.result.current.acknowledgeConnectionReleased;
      act(() => {
        card.unmount();
        release();
      });
    }
    expect(getCanvasRoomPolicySnapshot().active).toBe(0);
  });
});
