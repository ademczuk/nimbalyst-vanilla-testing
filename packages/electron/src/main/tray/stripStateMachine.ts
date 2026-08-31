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
  STATE_URGENCY,
  formatFleetAge,
  isWantingState,
  type FleetPriority,
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
      stalled: number;
      unread: number;
      /** Present only while something is blocked. Never an informational duration. */
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
  return `counts:${view.needsApproval}:${view.needsDecision}:${view.running}:${view.failed}:${view.stalled}:${view.unread}:${age}`;
}

/**
 * Nothing to say: no counts, no name, no age.
 *
 * The idle render is the app glyph and nothing else. It used to be *nothing at
 * all*, on the reasoning that the tray icon was still there to open the panel
 * with -- which stopped being true when the island took the tray item's place.
 * A `named` view is never idle, so the name hold is what keeps the island from
 * shrinking the instant the last session settles; the hysteresis is free.
 *
 * The one remaining consumer is the idle summary: this is what decides whether
 * the panel offers recent sessions instead of live ones.
 */
export function isIdleView(view: StripView): boolean {
  if (view.mode === 'named') return false;
  return (
    view.needsApproval === 0
    && view.needsDecision === 0
    && view.running === 0
    && view.failed === 0
    && view.stalled === 0
    && view.unread === 0
  );
}

export class StripStateMachine {
  private readonly holdMs: number;
  /** sessionId -> the `since` we already named it for. */
  private readonly namedAt = new Map<string, number>();
  /**
   * The announcement currently on screen, held by value.
   *
   * By value, not by id: a finished session drops out of the snapshot's
   * priority slot as soon as the user acts on it (clicking marks it read and
   * navigates), and reading the name back off the live snapshot made it vanish
   * at exactly that moment. What is being announced already happened, so the
   * machine owns a copy for the duration of the hold.
   */
  private holding: FleetPriority | null = null;
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
      // Remembered either way. If this transition is not important enough to
      // interrupt what is on screen, surfacing it later -- once the hold
      // expires -- would be movement decoupled from its cause, which is the one
      // thing the naming design is trying to avoid.
      this.remember(priority.sessionId, priority.since);
      if (this.canInterrupt(priority, now)) {
        this.holding = priority;
        this.holdUntil = now + this.holdMs;
      }
    }

    return this.render(now);
  }

  /**
   * Whether a new transition may take the slot from the one being held.
   *
   * Only *informational* holds are protected. A session finishing is worth a
   * few seconds of the user's attention even after they click it, and a session
   * merely starting is not reason enough to wipe that away. A wanting name has
   * no such protection: it still yields to whatever transitioned most recently,
   * because the newer thing is by definition also waiting on the user.
   */
  private canInterrupt(next: FleetPriority, now: number): boolean {
    const held = this.holding;
    if (!held || now >= this.holdUntil) return true;
    if (isWantingState(held.state)) return true;
    return STATE_URGENCY[next.state] >= STATE_URGENCY[held.state];
  }

  /** Recompute against the last snapshot at a later time -- hold expiry, minute tick. */
  tick(now: number): StripView {
    return this.render(now);
  }

  /** When the current name hold ends, or null when no name is being held. */
  holdEndsAt(): number | null {
    return this.holding === null ? null : this.holdUntil;
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
        stalled: 0,
        unread: 0,
        age: null,
      };
    }

    const held = this.holding;
    if (held && now < this.holdUntil) {
      // A *wanting* name additionally survives only while that session is still
      // the priority. That is what drops it the moment its prompt is answered,
      // with no separate "did it resolve" signal: a name that says a session
      // needs you when it no longer does is worse than no name at all.
      //
      // `completed` and `running` carry no such claim, so they run out their
      // hold on the clock. Requiring them to stay the priority meant clicking a
      // finished session erased the announcement of it.
      if (!isWantingState(held.state) || snapshot.priority?.sessionId === held.sessionId) {
        return {
          mode: 'named',
          sessionId: held.sessionId,
          workspacePath: held.workspacePath,
          title: held.title,
          state: held.state,
          // By construction this is the session that just transitioned.
          age: { label: 'now', hot: false },
        };
      }
    }

    this.holding = null;
    return countsView(snapshot, now);
  }
}

function countsView(snapshot: FleetSnapshot, now: number): StripView {
  // Only ever the blocked-age. There is deliberately no other branch: the strip
  // once showed the time since the last activity when the fleet was quiet, which
  // put an unlabeled, unactionable duration in the slot reserved for "how long
  // has something been waiting on you" and read, on a fresh launch, as a live
  // fact when it was a `MAX(updated_at)` off the database. See the State
  // inventory in the plan before adding a second source here.
  let age: StripAge | null = null;
  if (snapshot.oldestWantingSince !== undefined) {
    // A count tells you something is waiting; the age tells you whether to care.
    const elapsed = Math.max(0, now - snapshot.oldestWantingSince);
    age = { label: formatFleetAge(elapsed), hot: elapsed >= AGE_HOT_MS };
  }

  return {
    mode: 'counts',
    needsApproval: snapshot.needsApproval,
    needsDecision: snapshot.needsDecision,
    running: snapshot.running,
    failed: snapshot.failed,
    stalled: snapshot.stalled,
    unread: snapshot.unread,
    age,
  };
}
