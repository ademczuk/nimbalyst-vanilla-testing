// @vitest-environment node
import { describe, it, expect } from 'vitest';

import { deriveFleetSnapshot, formatFleetAge, type TraySessionInfo } from '../fleetSnapshot';
import { STRIP_NAME_HOLD_MS, StripStateMachine } from '../stripStateMachine';

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

describe('deriveFleetSnapshot', () => {
  it('counts each session once, splitting approval from decision', () => {
    const snapshot = deriveFleetSnapshot([
      session({ sessionId: 'perm', hasPendingPrompt: true, promptKind: 'approval', wantingSince: NOW - 1000 }),
      session({ sessionId: 'commit', hasPendingPrompt: true, promptKind: 'approval', wantingSince: NOW - 2000 }),
      session({ sessionId: 'question', hasPendingPrompt: true, promptKind: 'decision', wantingSince: NOW - 3000 }),
      session({ sessionId: 'busy' }),
      session({ sessionId: 'broken', status: 'error', wantingSince: NOW - 4000 }),
      session({ sessionId: 'read-me', status: 'completed', hasUnread: true }),
      session({ sessionId: 'quiet', status: 'completed' }),
    ], 1);

    expect(snapshot).toMatchObject({
      needsApproval: 2,
      needsDecision: 1,
      failed: 1,
      running: 1,
      unread: 1,
      revision: 1,
    });
    // The oldest thing wanting something -- what the strip's age reports.
    expect(snapshot.oldestWantingSince).toBe(NOW - 4000);
  });

  // Mirrors groupTraySessions / agentSessionAttentionAtom: an agent sets phase
  // 'complete' just before its closing output, so it may only suppress running.
  it('excludes archived sessions and lets complete-phase suppress only running', () => {
    const snapshot = deriveFleetSnapshot([
      session({ sessionId: 'archived', status: 'completed', hasUnread: true, isArchived: true }),
      session({ sessionId: 'done-streaming', phase: 'complete' }),
      session({ sessionId: 'done-prompting', hasPendingPrompt: true, phase: 'complete' }),
      session({ sessionId: 'done-unread', status: 'completed', hasUnread: true, phase: 'complete' }),
    ], 2);

    expect(snapshot).toMatchObject({ running: 0, needsApproval: 1, unread: 1 });
  });

  it('gives the priority slot to the session that most recently started wanting something', () => {
    const snapshot = deriveFleetSnapshot([
      session({ sessionId: 'older', title: 'Older', hasPendingPrompt: true, promptKind: 'approval', wantingSince: NOW - 9000 }),
      session({ sessionId: 'newer', title: 'Newer', hasPendingPrompt: true, promptKind: 'decision', wantingSince: NOW - 100 }),
    ], 3);

    expect(snapshot.priority).toMatchObject({ sessionId: 'newer', title: 'Newer', state: 'decision' });
  });

  it('breaks a same-millisecond tie toward the more urgent state', () => {
    const snapshot = deriveFleetSnapshot([
      session({ sessionId: 'a-waiting', hasPendingPrompt: true, promptKind: 'approval', wantingSince: NOW }),
      session({ sessionId: 'z-failed', status: 'error', wantingSince: NOW }),
    ], 4);

    expect(snapshot.priority).toMatchObject({ sessionId: 'z-failed', state: 'failed' });
  });

  // A failed session is not waiting on an answer any more, it is broken -- so it
  // must not also be counted as needing approval.
  // Finishing is worth announcing, but it is not something to act on: it must
  // not join the waiting count, and it must not drag the blocked-age to zero
  // every time a turn ends.
  it('lets a finished session own the priority slot without counting as waiting', () => {
    const snapshot = deriveFleetSnapshot([
      session({ sessionId: 'blocked', hasPendingPrompt: true, promptKind: 'approval', wantingSince: NOW - 30 * 60_000 }),
      session({ sessionId: 'done', title: 'Done', status: 'completed', completedAt: NOW }),
    ], 6);

    expect(snapshot.priority).toMatchObject({ sessionId: 'done', state: 'completed' });
    expect(snapshot).toMatchObject({ needsApproval: 1, needsDecision: 0, failed: 0, running: 0 });
    expect(snapshot.oldestWantingSince).toBe(NOW - 30 * 60_000);
  });

  // Unread rows seeded from the database at startup carry no `completedAt`, and
  // running sessions restored into the cache carry no `startedAt`. Neither may
  // claim a name the first time the strip renders.
  it('does not name a session whose start or completion this process never saw', () => {
    const snapshot = deriveFleetSnapshot([
      session({ sessionId: 'seeded', status: 'completed', hasUnread: true }),
      session({ sessionId: 'restored', status: 'running' }),
    ], 7);

    expect(snapshot.priority).toBeUndefined();
    expect(snapshot).toMatchObject({ unread: 1, running: 1 });
  });

  it('lets a session that just started own the priority slot', () => {
    const snapshot = deriveFleetSnapshot([
      session({ sessionId: 'old', status: 'running', startedAt: NOW - 60_000 }),
      session({ sessionId: 'fresh', title: 'Fresh', status: 'running', startedAt: NOW }),
    ], 8);

    expect(snapshot.priority).toMatchObject({ sessionId: 'fresh', state: 'running' });
    expect(snapshot.running).toBe(2);
    // Starting is not waiting, so it must not invent a blocked-age.
    expect(snapshot.oldestWantingSince).toBeUndefined();
  });

  it('counts a session that failed with a prompt open as failed, not waiting', () => {
    const snapshot = deriveFleetSnapshot([
      session({ sessionId: 's', status: 'error', hasPendingPrompt: true, promptKind: 'decision', wantingSince: NOW }),
    ], 5);

    expect(snapshot).toMatchObject({ failed: 1, needsApproval: 0, needsDecision: 0 });
  });
});

describe('formatFleetAge', () => {
  it('rounds down to whole minutes, then to hours and minutes', () => {
    expect(formatFleetAge(8_000)).toBe('0m');
    expect(formatFleetAge(14 * 60_000)).toBe('14m');
    expect(formatFleetAge(59 * 60_000 + 59_000)).toBe('59m');
    expect(formatFleetAge(72 * 60_000)).toBe('1h12m');
    expect(formatFleetAge(25 * 60 * 60_000)).toBe('1d');
  });
});

describe('StripStateMachine', () => {
  function waiting(sessionId: string, since: number, kind: 'approval' | 'decision' = 'approval') {
    return session({ sessionId, title: sessionId, hasPendingPrompt: true, promptKind: kind, wantingSince: since });
  }

  it('expands to name a session on the transition, then settles back to counts', () => {
    const machine = new StripStateMachine();

    expect(machine.update(deriveFleetSnapshot([session({ sessionId: 'busy' })], 1), NOW))
      .toMatchObject({ mode: 'counts', running: 1, age: null });

    const asked = deriveFleetSnapshot([session({ sessionId: 'busy' }), waiting('ask', NOW, 'decision')], 2);
    expect(machine.update(asked, NOW)).toMatchObject({ mode: 'named', title: 'ask', state: 'decision' });

    // Still inside the hold.
    expect(machine.tick(NOW + STRIP_NAME_HOLD_MS - 1)).toMatchObject({ mode: 'named' });
    // ...and out of it.
    expect(machine.tick(NOW + STRIP_NAME_HOLD_MS)).toMatchObject({
      mode: 'counts',
      needsApproval: 0,
      needsDecision: 1,
      running: 1,
    });
  });

  it('does not name a session again while it stays in the same wanting state', () => {
    const machine = new StripStateMachine();
    const snapshot = () => deriveFleetSnapshot([waiting('ask', NOW)], 2);

    machine.update(snapshot(), NOW);
    // Settle out of the hold, then feed the same still-waiting session again --
    // a name is only news once.
    machine.tick(NOW + STRIP_NAME_HOLD_MS);
    expect(machine.update(snapshot(), NOW + STRIP_NAME_HOLD_MS + 1)).toMatchObject({ mode: 'counts' });
  });

  it('names a session again when it leaves and re-enters a wanting state', () => {
    const machine = new StripStateMachine();
    machine.update(deriveFleetSnapshot([waiting('ask', NOW)], 1), NOW);
    machine.update(deriveFleetSnapshot([session({ sessionId: 'ask' })], 2), NOW + 10_000);

    const again = deriveFleetSnapshot([waiting('ask', NOW + 20_000)], 3);
    expect(machine.update(again, NOW + 20_000)).toMatchObject({ mode: 'named', title: 'ask' });
  });

  it('hands the name to a newer transition mid-hold', () => {
    const machine = new StripStateMachine();
    machine.update(deriveFleetSnapshot([waiting('first', NOW)], 1), NOW);

    const both = deriveFleetSnapshot([waiting('first', NOW), waiting('second', NOW + 2000)], 2);
    expect(machine.update(both, NOW + 2000)).toMatchObject({ mode: 'named', title: 'second' });
    // The hold restarts with the new name rather than finishing the old one.
    expect(machine.tick(NOW + STRIP_NAME_HOLD_MS + 1)).toMatchObject({ mode: 'named', title: 'second' });
  });

  it('drops a name as soon as that session stops wanting anything', () => {
    const machine = new StripStateMachine();
    machine.update(deriveFleetSnapshot([waiting('ask', NOW)], 1), NOW);

    const answered = deriveFleetSnapshot([session({ sessionId: 'ask' })], 2);
    expect(machine.update(answered, NOW + 1000)).toMatchObject({ mode: 'counts' });
  });

  it('ignores a snapshot that arrives out of order', () => {
    const machine = new StripStateMachine();
    machine.update(deriveFleetSnapshot([waiting('ask', NOW)], 5), NOW);
    machine.tick(NOW + STRIP_NAME_HOLD_MS);

    const stale = deriveFleetSnapshot([session({ sessionId: 'busy' })], 4);
    expect(machine.update(stale, NOW + STRIP_NAME_HOLD_MS)).toMatchObject({
      mode: 'counts',
      needsApproval: 1,
      running: 0,
    });
  });

  it('ages the oldest waiting session, and escalates past an hour', () => {
    const machine = new StripStateMachine();
    const snapshot = deriveFleetSnapshot(
      [waiting('old', NOW - 72 * 60_000), waiting('new', NOW - 60_000)],
      1,
    );
    machine.update(snapshot, NOW);

    expect(machine.tick(NOW + STRIP_NAME_HOLD_MS)).toMatchObject({
      mode: 'counts',
      age: { label: '1h12m', hot: true },
    });
  });

  it('shows how long it has been quiet when nothing is running or waiting', () => {
    const machine = new StripStateMachine();
    const snapshot = deriveFleetSnapshot(
      [session({ sessionId: 'done', status: 'completed', updatedAt: NOW - 5 * 60_000 })],
      1,
    );

    expect(machine.update(snapshot, NOW)).toMatchObject({
      mode: 'counts',
      running: 0,
      // Idle is not a stall, so the quiet age never escalates.
      age: { label: '5m', hot: false },
    });
  });

  // Completed sessions are evicted from the tray cache after a minute, so by the
  // time the machine is genuinely quiet there is nothing left to read an age off.
  // Without the caller-supplied floor the strip would silently drop the one
  // element that tells idle apart from broken.
  it('still shows a quiet age after every session has left the cache', () => {
    const machine = new StripStateMachine();
    const snapshot = deriveFleetSnapshot([], 1, { lastActivityAt: NOW - 42 * 60_000 });

    expect(machine.update(snapshot, NOW)).toMatchObject({
      mode: 'counts',
      age: { label: '42m', hot: false },
    });
  });

  it('names a session when it starts, then settles to the running count', () => {
    const machine = new StripStateMachine();
    const started = deriveFleetSnapshot(
      [session({ sessionId: 'work', title: 'Work', status: 'running', startedAt: NOW })],
      1,
    );

    expect(machine.update(started, NOW)).toMatchObject({
      mode: 'named',
      title: 'Work',
      state: 'running',
    });
    expect(machine.tick(NOW + STRIP_NAME_HOLD_MS)).toMatchObject({ mode: 'counts', running: 1 });
  });

  // `startedAt` is stamped on the transition into running, not per streaming
  // tick, so a session that works for an hour is announced once.
  it('does not re-name a session that keeps running', () => {
    const machine = new StripStateMachine();
    const running = (revision: number) => deriveFleetSnapshot(
      [session({ sessionId: 'work', title: 'Work', status: 'running', startedAt: NOW })],
      revision,
    );

    machine.update(running(1), NOW);
    machine.tick(NOW + STRIP_NAME_HOLD_MS);
    expect(machine.update(running(2), NOW + STRIP_NAME_HOLD_MS + 1)).toMatchObject({
      mode: 'counts',
      running: 1,
    });
  });

  it('names a session when it finishes, then settles to the unread count', () => {
    const machine = new StripStateMachine();
    machine.update(deriveFleetSnapshot([session({ sessionId: 'work', title: 'Work' })], 1), NOW);

    // Finished while the user was away, so it is also unread.
    const finished = deriveFleetSnapshot([
      session({ sessionId: 'work', title: 'Work', status: 'completed', completedAt: NOW, hasUnread: true }),
    ], 2);

    expect(machine.update(finished, NOW)).toMatchObject({
      mode: 'named',
      title: 'Work',
      state: 'completed',
    });
    expect(machine.tick(NOW + STRIP_NAME_HOLD_MS)).toMatchObject({ mode: 'counts', unread: 1 });
  });

  it('shows no age while sessions run and nothing wants anything', () => {
    const machine = new StripStateMachine();
    const snapshot = deriveFleetSnapshot([session({ sessionId: 'busy' })], 1);
    expect(machine.update(snapshot, NOW)).toMatchObject({ mode: 'counts', running: 1, age: null });
  });
});
