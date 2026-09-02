/**
 * The Live Activity's half of the ambient fleet surface.
 *
 * The menu bar has room for exactly one name, so `FleetSnapshot.priority` is all
 * the strip ever needs. The lock screen has vertical room for three rows, and
 * that difference is the whole reason this module exists: the phone renders a
 * ranked *list* of the things waiting on you, not the single most recent
 * transition. Everything else -- the counts, the bucketing, what counts as
 * stalled -- still comes from `deriveFleetSnapshot`, so the two surfaces cannot
 * disagree about what the fleet is doing.
 *
 * Pure and clock-injected for the same reason the snapshot is: the stalled row
 * is the one classification that depends on the wall clock, and a defaulted
 * `Date.now()` would silently measure a pinned fixture against real time.
 */

import path from 'path';

import {
  isStalled,
  lastSignOfLife,
  type FleetSnapshot,
  type TraySessionInfo,
} from './fleetSnapshot';

/**
 * What a row on the card is saying.
 *
 * A subset of `PriorityState`: `running` and `completed` never earn a row. The
 * mockup's rule is that running sessions collapse into the footer count -- they
 * are ambient, not actionable, and a row that says "still working" costs the
 * space of a row that says "waiting on you".
 */
export type FleetActivityRowState = 'approval' | 'decision' | 'failed' | 'stalled';

export interface FleetActivityRow {
  sessionId: string;
  title: string;
  /** Basename of the workspace path -- the card has no room for the full path. */
  project: string;
  state: FleetActivityRowState;
  /** Epoch ms this session entered `state`. The phone renders the elapsed time from it. */
  since: number;
}

/**
 * The wire shape the phone renders.
 *
 * Deliberately flat and plaintext, matching the existing `requestMobilePush`
 * lane: session titles already travel to APNs unencrypted, and the plan settled
 * that lock-screen exposure rather than coarsening to counts-plus-project.
 *
 * `updatedAt` and `staleAfterMs` are what make a sleeping Mac look asleep rather
 * than confidently wrong. ActivityKit's `staleDate` is computed from them on the
 * phone, so a desktop that stops sending degrades to a visibly dimmed card.
 */
export interface FleetActivityPayload {
  running: number;
  needsApproval: number;
  needsDecision: number;
  failed: number;
  stalled: number;
  unread: number;
  /** Ranked, at most `FLEET_ACTIVITY_ROW_LIMIT`. Empty means nothing is waiting. */
  rows: FleetActivityRow[];
  /** How many sessions are waiting but did not fit in `rows`. */
  overflow: number;
  /** Mirrors `FleetSnapshot.revision`; lets the phone drop an out-of-order update. */
  revision: number;
  /** Epoch ms this payload was generated on the desktop. */
  updatedAt: number;
  /** How long after `updatedAt` the card should call itself stale. */
  staleAfterMs: number;
}

/**
 * Three rows.
 *
 * The lock-screen card and the expanded Dynamic Island both show the same list,
 * and the island is the tighter of the two. Four rows fit on the lock screen and
 * clip in the island, which would make the two presentations disagree about what
 * is waiting -- worse than showing one fewer.
 */
export const FLEET_ACTIVITY_ROW_LIMIT = 3;

/**
 * How long a card may go without an update before it says so.
 *
 * Sized against the publisher's minimum interval and the desktop's own age tick,
 * not against a guess: the desktop re-derives on a timer even when nothing is
 * happening, so silence for several of those intervals means the desktop is gone,
 * not that the fleet is quiet.
 */
export const FLEET_ACTIVITY_STALE_AFTER_MS = 12 * 60_000;

/**
 * Rank order between the row states.
 *
 * Not `STATE_URGENCY`. That one answers "which transition should the menu bar
 * interrupt itself to announce", where a failure is the loudest thing there is.
 * This one answers "what should you deal with first", and the mockup's rule is
 * the opposite for failures: a failed session is dead, not blocking, and it
 * cannot get worse while you deal with a live one. So it ranks below anything
 * actually waiting on you and above a stall, which is only a suspicion.
 */
const ROW_RANK: Record<FleetActivityRowState, number> = {
  approval: 3,
  decision: 3,
  failed: 2,
  stalled: 1,
};

/** Within a rank, a three-second tap beats a decision that needs thinking. */
const TIEBREAK: Record<FleetActivityRowState, number> = {
  approval: 1,
  decision: 0,
  failed: 0,
  stalled: 0,
};

function rowStateOf(session: TraySessionInfo, now: number): FleetActivityRowState | null {
  if (session.isArchived) return null;
  if (session.status === 'error') return 'failed';
  if (session.hasPendingPrompt) return session.promptKind === 'decision' ? 'decision' : 'approval';
  if (session.status === 'running' && session.phase !== 'complete' && isStalled(session, now)) {
    return 'stalled';
  }
  return null;
}

function sinceOf(session: TraySessionInfo, state: FleetActivityRowState): number {
  // A stalled row shows the silent-for age, per the state table in the plan: the
  // useful number is how long the session has said nothing, not how long it has
  // been over the threshold. It also means the row's timer keeps meaning the
  // same thing if the threshold is ever retuned.
  //
  // Off the same stamp `isStalled` judged it on, not `updatedAt`: a turn whose
  // last lifecycle transition is far older than its last liveness tick would
  // otherwise tell the phone it had been silent for forty minutes when the
  // desktop stalled it for fifteen.
  if (state === 'stalled') return lastSignOfLife(session) ?? 0;
  return session.wantingSince ?? session.updatedAt ?? 0;
}

/**
 * Rank the sessions the card has room to name.
 *
 * Longest-waiting first inside a rank, because dead wall-clock is the cost being
 * minimised; prompt kind breaks an exact tie; the session id breaks that, purely
 * so a fixture means the same thing twice.
 */
export function rankFleetActivityRows(
  sessions: Iterable<TraySessionInfo>,
  now: number,
  limit: number = FLEET_ACTIVITY_ROW_LIMIT,
): { rows: FleetActivityRow[]; overflow: number } {
  const candidates: FleetActivityRow[] = [];

  for (const session of sessions) {
    const state = rowStateOf(session, now);
    if (!state) continue;
    candidates.push({
      sessionId: session.sessionId,
      title: session.title || 'Untitled Session',
      project: session.workspacePath ? path.basename(session.workspacePath) : '',
      state,
      since: sinceOf(session, state),
    });
  }

  candidates.sort((a, b) => {
    if (ROW_RANK[a.state] !== ROW_RANK[b.state]) return ROW_RANK[b.state] - ROW_RANK[a.state];
    if (a.since !== b.since) return a.since - b.since;
    if (TIEBREAK[a.state] !== TIEBREAK[b.state]) return TIEBREAK[b.state] - TIEBREAK[a.state];
    return a.sessionId < b.sessionId ? -1 : 1;
  });

  return {
    rows: candidates.slice(0, limit),
    overflow: Math.max(0, candidates.length - limit),
  };
}

/**
 * Project a snapshot plus its sessions into what the phone renders.
 *
 * Takes the snapshot rather than re-deriving the counts so there is exactly one
 * definition of "running" and one of "stalled" in the process. The sessions are
 * passed alongside because the snapshot deliberately keeps only one named
 * session, and the card needs three.
 */
export function buildFleetActivityPayload(
  snapshot: FleetSnapshot,
  sessions: Iterable<TraySessionInfo>,
  now: number,
): FleetActivityPayload {
  const { rows, overflow } = rankFleetActivityRows(sessions, now);
  return {
    running: snapshot.running,
    needsApproval: snapshot.needsApproval,
    needsDecision: snapshot.needsDecision,
    failed: snapshot.failed,
    stalled: snapshot.stalled,
    unread: snapshot.unread,
    rows,
    overflow,
    revision: snapshot.revision,
    updatedAt: now,
    staleAfterMs: FLEET_ACTIVITY_STALE_AFTER_MS,
  };
}

/**
 * Whether there is anything for the activity to be about.
 *
 * The same rule as "idle hides the island", one surface over: an activity that
 * says nothing is a notch of lock-screen real estate charged for no information.
 * Unread counts, because the phone is exactly where you catch up on a session
 * that finished while you were away -- which is the one thing the menu bar
 * cannot do, since you were not at the Mac.
 */
export function isFleetActive(payload: FleetActivityPayload): boolean {
  return (
    payload.running > 0 ||
    payload.needsApproval > 0 ||
    payload.needsDecision > 0 ||
    payload.failed > 0 ||
    payload.stalled > 0 ||
    payload.unread > 0
  );
}
