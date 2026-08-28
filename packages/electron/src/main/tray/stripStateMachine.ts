/**
 * The menu bar strip's transient-naming state machine.
 *
 * Pure: a stream of `FleetSnapshot`s in, a `StripView` describing what to draw
 * right now out. No Electron, no timers of its own -- the caller schedules the
 * wake-ups it asks for via `holdEndsAt()`.
 *
 * The behaviour it encodes, settled in design and not to be re-litigated:
 *
 * - **Expand to name, then settle back to counts.** The strip widens to name a
 *   session at the moment that session starts wanting something, holds for a few
 *   seconds, then collapses. Permanent naming pays maximum width all day for a
 *   fact that changes twice an hour; timed rotation is motion decoupled from
 *   cause, and motion in peripheral vision pulls the eye.
 * - **A name is only news once.** After you have seen that a session is waiting,
 *   the count carries it. A session is named on the transition *into* a wanting
 *   state, not repeatedly while it sits there.
 * - **The most recently changed session owns the name.** Naming an older waiter
 *   on a newer waiter's transition would be movement decoupled from its cause.
 */

import {
  AGE_HOT_MS,
  formatFleetAge,
  type FleetSnapshot,
  type PriorityState,
} from './fleetSnapshot';

/** Long enough to read, short enough not to nag. Wants trying, not deciding. */
export const STRIP_NAME_HOLD_MS = 8_000;

/**
 * How many named sessions to remember for the "only news once" rule.
 *
 * A snapshot carries counts and one priority, not the set of live sessions, so
 * there is no event that says "this session is gone, forget it was named". A
 * bounded FIFO is the honest answer: worst case a very old session gets named a
 * second time, which is a strictly better failure than unbounded growth.
 */
const NAMED_MEMORY_LIMIT = 128;

export interface StripAge {
  label: string;
  /** Past an hour the age goes amber and bold -- the strip's only escalation. */
  hot: boolean;
}

export type StripView =
  | {
      mode: 'counts';
      needsApproval: number;
      needsDecision: number;
      running: number;
      failed: number;
      unread: number;
      /** Absent when sessions are running but nothing wants anything. */
      age: StripAge | null;
    }
  | {
      mode: 'named';
      sessionId: string;
      workspacePath: string;
      title: string;
      state: PriorityState;
      age: StripAge;
    };

/** Identity of a rendered strip, so an unchanged view can skip a re-render. */
export function stripViewKey(view: StripView): string {
  const age = view.age ? `${view.age.label}${view.age.hot ? '!' : ''}` : '-';
  if (view.mode === 'named') {
    return `named:${view.sessionId}:${view.state}:${view.title}:${age}`;
  }
  return `counts:${view.needsApproval}:${view.needsDecision}:${view.running}:${view.failed}:${view.unread}:${age}`;
}

export class StripStateMachine {
  private readonly holdMs: number;
  /** sessionId -> the `since` we already named it for. */
  private readonly namedAt = new Map<string, number>();
  private holdingSessionId: string | null = null;
  private holdUntil = 0;
  private latest: FleetSnapshot | null = null;

  constructor(options: { holdMs?: number } = {}) {
    this.holdMs = options.holdMs ?? STRIP_NAME_HOLD_MS;
  }

  /**
   * Feed a snapshot and get the view to draw.
   *
   * Snapshots that arrive out of order are dropped -- that is what `revision` is
   * for -- and the current view is returned unchanged.
   */
  update(snapshot: FleetSnapshot, now: number): StripView {
    if (this.latest && snapshot.revision < this.latest.revision) {
      return this.render(now);
    }
    this.latest = snapshot;

    const priority = snapshot.priority;
    if (priority && this.namedAt.get(priority.sessionId) !== priority.since) {
      this.remember(priority.sessionId, priority.since);
      this.holdingSessionId = priority.sessionId;
      this.holdUntil = now + this.holdMs;
    }

    return this.render(now);
  }

  /** Recompute against the last snapshot at a later time -- hold expiry, minute tick. */
  tick(now: number): StripView {
    return this.render(now);
  }

  /** When the current name hold ends, or null when no name is being held. */
  holdEndsAt(): number | null {
    return this.holdingSessionId === null ? null : this.holdUntil;
  }

  private remember(sessionId: string, since: number): void {
    // Re-insert so the FIFO order reflects most-recently-named.
    this.namedAt.delete(sessionId);
    this.namedAt.set(sessionId, since);
    while (this.namedAt.size > NAMED_MEMORY_LIMIT) {
      const oldest = this.namedAt.keys().next();
      if (oldest.done) break;
      this.namedAt.delete(oldest.value);
    }
  }

  private render(now: number): StripView {
    const snapshot = this.latest;
    if (!snapshot) {
      return {
        mode: 'counts',
        needsApproval: 0,
        needsDecision: 0,
        running: 0,
        failed: 0,
        unread: 0,
        age: null,
      };
    }

    const priority = snapshot.priority;
    // The hold survives only while the named session is still the priority. That
    // is what drops a stale name the moment its prompt is answered -- no separate
    // "did it resolve" signal needed -- and what hands the slot straight over
    // when a newer session transitions mid-hold.
    if (priority && this.holdingSessionId === priority.sessionId && now < this.holdUntil) {
      return {
        mode: 'named',
        sessionId: priority.sessionId,
        workspacePath: priority.workspacePath,
        title: priority.title,
        state: priority.state,
        // By construction this is the session that just transitioned.
        age: { label: 'now', hot: false },
      };
    }

    this.holdingSessionId = null;
    return countsView(snapshot, now);
  }
}

function countsView(snapshot: FleetSnapshot, now: number): StripView {
  const wanting = snapshot.needsApproval + snapshot.needsDecision + snapshot.failed;

  let age: StripAge | null = null;
  if (wanting > 0 && snapshot.oldestWantingSince !== undefined) {
    // A count tells you something is waiting; the age tells you whether to care.
    const elapsed = Math.max(0, now - snapshot.oldestWantingSince);
    age = { label: formatFleetAge(elapsed), hot: elapsed >= AGE_HOT_MS };
  } else if (wanting === 0 && snapshot.running === 0 && snapshot.lastActivityAt !== undefined) {
    // Quiet: the age is the only thing distinguishing idle from broken. It never
    // escalates -- nothing is stalled, the machine is just not busy.
    age = { label: formatFleetAge(Math.max(0, now - snapshot.lastActivityAt)), hot: false };
  }

  return {
    mode: 'counts',
    needsApproval: snapshot.needsApproval,
    needsDecision: snapshot.needsDecision,
    running: snapshot.running,
    failed: snapshot.failed,
    unread: snapshot.unread,
    age,
  };
}
