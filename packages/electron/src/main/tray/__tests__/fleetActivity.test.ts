// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deriveFleetSnapshot, STALL_AFTER_MS, type TraySessionInfo } from '../fleetSnapshot';
import { buildFleetActivityPayload, isFleetActive, rankFleetActivityRows } from '../fleetActivity';
import {
  FLEET_PUBLISH_DEBOUNCE_MS,
  FLEET_PUBLISH_HEARTBEAT_MS,
  FLEET_PUBLISH_MIN_INTERVAL_MS,
  FLEET_PUBLISH_URGENT_DEBOUNCE_MS,
  FleetActivityPublisher,
  fleetActivityChanged,
  isUrgentFleetChange,
} from '../fleetActivityPublisher';

const NOW = 1_700_000_000_000;

function session(overrides: Partial<TraySessionInfo> & { sessionId: string }): TraySessionInfo {
  return {
    title: overrides.sessionId,
    workspacePath: '/Users/dev/projects/nimbalyst',
    status: 'running',
    isStreaming: false,
    hasPendingPrompt: false,
    hasUnread: false,
    updatedAt: NOW,
    ...overrides,
  };
}

function blocked(id: string, kind: 'approval' | 'decision', since: number): TraySessionInfo {
  return session({ sessionId: id, hasPendingPrompt: true, promptKind: kind, wantingSince: since });
}

describe('rankFleetActivityRows', () => {
  it('ranks by how long the user has been the bottleneck, oldest first', () => {
    const { rows } = rankFleetActivityRows([
      blocked('recent', 'approval', NOW - 60_000),
      blocked('ancient', 'decision', NOW - 900_000),
      blocked('middle', 'approval', NOW - 300_000),
    ], NOW);

    expect(rows.map((row) => row.sessionId)).toEqual(['ancient', 'middle', 'recent']);
  });

  // "Errors rank high but never top": a failed session is dead, not blocking,
  // and it cannot get worse while you deal with a live one.
  it('keeps a failure below anything actually waiting, however old the failure is', () => {
    const { rows } = rankFleetActivityRows([
      session({ sessionId: 'crashed', status: 'error', wantingSince: NOW - 3_600_000 }),
      blocked('waiting', 'decision', NOW - 10_000),
    ], NOW);

    expect(rows.map((row) => row.sessionId)).toEqual(['waiting', 'crashed']);
  });

  it('breaks an exact tie towards the three-second tap', () => {
    const { rows } = rankFleetActivityRows([
      blocked('think', 'decision', NOW - 5_000),
      blocked('tap', 'approval', NOW - 5_000),
    ], NOW);

    expect(rows[0].sessionId).toBe('tap');
  });

  // The mockup's rule: running sessions collapse into the footer count. A row
  // that says "still working" costs the space of a row that says "waiting".
  it('gives no row to a healthy running session, and one to a stalled one', () => {
    const { rows } = rankFleetActivityRows([
      session({ sessionId: 'busy', updatedAt: NOW - 60_000 }),
      session({ sessionId: 'silent', updatedAt: NOW - STALL_AFTER_MS }),
    ], NOW);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sessionId: 'silent', state: 'stalled', since: NOW - STALL_AFTER_MS });
  });

  // The phone renders the elapsed time from `since`, so a stalled row has to
  // count from the same evidence of progress the desktop stalled it on. Reading
  // `updatedAt` here would show a wedged session as silent for far longer than
  // it was, and disagree with the panel row next to it.
  it('counts a stalled row from the liveness stamp, not the last transition', () => {
    const { rows } = rankFleetActivityRows([
      session({
        sessionId: 'wedged',
        updatedAt: NOW - 40 * 60_000,
        liveAt: NOW - STALL_AFTER_MS,
        turnInFlight: true,
      }),
    ], NOW);

    expect(rows[0]).toMatchObject({ state: 'stalled', since: NOW - STALL_AFTER_MS });
  });

  it('reports what did not fit rather than silently dropping it', () => {
    const { rows, overflow } = rankFleetActivityRows([
      blocked('a', 'approval', NOW - 5_000),
      blocked('b', 'approval', NOW - 4_000),
      blocked('c', 'approval', NOW - 3_000),
      blocked('d', 'approval', NOW - 2_000),
    ], NOW);

    expect(rows).toHaveLength(3);
    expect(overflow).toBe(1);
  });
});

describe('buildFleetActivityPayload', () => {
  it('carries the snapshot counts verbatim so the two surfaces cannot disagree', () => {
    const sessions = [
      blocked('ask', 'decision', NOW - 30_000),
      session({ sessionId: 'busy' }),
      session({ sessionId: 'crashed', status: 'error', wantingSince: NOW - 1_000 }),
    ];
    const snapshot = deriveFleetSnapshot(sessions, 7, { now: NOW });
    const payload = buildFleetActivityPayload(snapshot, sessions, NOW);

    expect(payload).toMatchObject({
      running: snapshot.running,
      needsDecision: snapshot.needsDecision,
      failed: snapshot.failed,
      revision: 7,
      updatedAt: NOW,
    });
    expect(payload.rows.map((row) => row.sessionId)).toEqual(['ask', 'crashed']);
    expect(payload.rows[0].project).toBe('nimbalyst');
  });

  it('is inactive only when there is nothing at all to say', () => {
    const empty = deriveFleetSnapshot([], 1, { now: NOW });
    expect(isFleetActive(buildFleetActivityPayload(empty, [], NOW))).toBe(false);

    const unreadOnly = [session({ sessionId: 'done', status: 'completed', hasUnread: true })];
    const snapshot = deriveFleetSnapshot(unreadOnly, 2, { now: NOW });
    // The phone is exactly where you catch up on a session that finished while
    // you were away, which is the one thing the menu bar cannot do.
    expect(isFleetActive(buildFleetActivityPayload(snapshot, unreadOnly, NOW))).toBe(true);
  });
});

describe('publish decisions', () => {
  function payload(sessions: TraySessionInfo[], revision: number, now = NOW) {
    return buildFleetActivityPayload(deriveFleetSnapshot(sessions, revision, { now }), sessions, now);
  }

  it('does not treat a new revision or timestamp as news', () => {
    const sessions = [session({ sessionId: 'busy' })];
    expect(fleetActivityChanged(payload(sessions, 1), payload(sessions, 2, NOW + 30_000))).toBe(false);
  });

  it('treats a session renamed mid-flight as news, since the card shows the old name', () => {
    const before = [blocked('ask', 'approval', NOW - 1_000)];
    const after = [{ ...before[0], title: 'Renamed' }];
    expect(fleetActivityChanged(payload(before, 1), payload(after, 2))).toBe(true);
  });

  it('calls a new blocked session urgent and a new running session not', () => {
    const idle = payload([], 1);
    const running = payload([session({ sessionId: 'busy' })], 2);
    const waiting = payload([session({ sessionId: 'busy' }), blocked('ask', 'approval', NOW)], 3);

    // The activity appearing at all is worth the short window: it is the moment
    // the surface teaches the user it exists.
    expect(isUrgentFleetChange(idle, running)).toBe(true);
    expect(isUrgentFleetChange(running, waiting)).toBe(true);
    expect(isUrgentFleetChange(waiting, running)).toBe(false);
    expect(isUrgentFleetChange(running, idle)).toBe(false);
  });
});

describe('FleetActivityPublisher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function payload(sessions: TraySessionInfo[], revision: number) {
    const now = Date.now();
    return buildFleetActivityPayload(deriveFleetSnapshot(sessions, revision, { now }), sessions, now);
  }

  it('coalesces a burst into one send', async () => {
    const send = vi.fn();
    const publisher = new FleetActivityPublisher({ send });

    publisher.submit(payload([session({ sessionId: 'a' })], 1));
    publisher.submit(payload([session({ sessionId: 'a' }), session({ sessionId: 'b' })], 2));
    publisher.submit(payload([
      session({ sessionId: 'a' }),
      session({ sessionId: 'b' }),
      session({ sessionId: 'c' }),
    ], 3));

    await vi.advanceTimersByTimeAsync(FLEET_PUBLISH_URGENT_DEBOUNCE_MS + 1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].running).toBe(3);

    publisher.stop();
  });

  it('holds an ordinary transition for the long window and a blocked one for the short', async () => {
    const send = vi.fn();
    const publisher = new FleetActivityPublisher({ send });

    // First submit is the activity appearing, which is urgent by definition.
    publisher.submit(payload([session({ sessionId: 'a' })], 1));
    await vi.advanceTimersByTimeAsync(FLEET_PUBLISH_URGENT_DEBOUNCE_MS + 1);
    expect(send).toHaveBeenCalledTimes(1);

    // A second running session is ambient: it waits out the long window, and
    // then the minimum interval on top.
    publisher.submit(payload([session({ sessionId: 'a' }), session({ sessionId: 'b' })], 2));
    await vi.advanceTimersByTimeAsync(FLEET_PUBLISH_DEBOUNCE_MS + 1);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(FLEET_PUBLISH_MIN_INTERVAL_MS);
    expect(send).toHaveBeenCalledTimes(2);

    publisher.stop();
  });

  it('shortens a pending long window when something starts waiting on the user', async () => {
    const send = vi.fn();
    const publisher = new FleetActivityPublisher({ send });
    publisher.submit(payload([session({ sessionId: 'a' })], 1));
    await vi.advanceTimersByTimeAsync(FLEET_PUBLISH_MIN_INTERVAL_MS + FLEET_PUBLISH_DEBOUNCE_MS);
    send.mockClear();

    publisher.submit(payload([session({ sessionId: 'a' }), session({ sessionId: 'b' })], 2));
    publisher.submit(payload([
      session({ sessionId: 'a' }),
      session({ sessionId: 'b' }),
      blocked('ask', 'approval', Date.now()),
    ], 3));

    await vi.advanceTimersByTimeAsync(FLEET_PUBLISH_URGENT_DEBOUNCE_MS + 1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].needsApproval).toBe(1);

    publisher.stop();
  });

  it('drops a change and its undo rather than sending a push that says nothing', async () => {
    const send = vi.fn();
    const publisher = new FleetActivityPublisher({ send });
    const steady = [session({ sessionId: 'a' })];

    publisher.submit(payload(steady, 1));
    await vi.advanceTimersByTimeAsync(FLEET_PUBLISH_MIN_INTERVAL_MS + FLEET_PUBLISH_DEBOUNCE_MS);
    send.mockClear();

    publisher.submit(payload([...steady, session({ sessionId: 'b' })], 2));
    publisher.submit(payload(steady, 3));
    await vi.advanceTimersByTimeAsync(FLEET_PUBLISH_MIN_INTERVAL_MS + FLEET_PUBLISH_DEBOUNCE_MS);

    expect(send).not.toHaveBeenCalled();
    publisher.stop();
  });

  // Without this the card crosses its stale date and dims while it is still
  // telling the truth, which is the one thing "dimmed" must not be able to mean.
  it('re-sends an unchanged running fleet before the card would call itself stale', async () => {
    const send = vi.fn();
    const publisher = new FleetActivityPublisher({ send });
    publisher.submit(payload([session({ sessionId: 'a' })], 1));
    await vi.advanceTimersByTimeAsync(FLEET_PUBLISH_URGENT_DEBOUNCE_MS + 1);
    expect(send).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(FLEET_PUBLISH_HEARTBEAT_MS + 1);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0].updatedAt).toBeGreaterThan(send.mock.calls[0][0].updatedAt);

    publisher.stop();
  });

  it('stops the heartbeat once the fleet goes quiet', async () => {
    const send = vi.fn();
    const publisher = new FleetActivityPublisher({ send });
    publisher.submit(payload([session({ sessionId: 'a' })], 1));
    await vi.advanceTimersByTimeAsync(FLEET_PUBLISH_URGENT_DEBOUNCE_MS + 1);
    publisher.submit(payload([], 2));
    await vi.advanceTimersByTimeAsync(FLEET_PUBLISH_MIN_INTERVAL_MS + FLEET_PUBLISH_DEBOUNCE_MS);
    expect(send).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(FLEET_PUBLISH_HEARTBEAT_MS * 2);
    expect(send).toHaveBeenCalledTimes(2);

    publisher.stop();
  });
});
