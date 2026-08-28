/**
 * FleetSnapshot -- the one derived value every ambient surface renders.
 *
 * The menu bar strip and (later) the iOS Live Activity both consume this and
 * nothing else, so the phone and the menu bar can never disagree about what the
 * fleet is doing. Derivation is a pure function over the same `TraySessionInfo`
 * values `groupTraySessions` already consumes, so it is testable without the
 * singleton, without Electron, and without a device.
 *
 * Bucketing deliberately matches `groupTraySessions` (archived excluded,
 * `phase === 'complete'` suppresses only the running bucket). It differs in one
 * way the panel does not need: a session lands in exactly one *counted* bucket,
 * so the strip's numbers add up.
 */

/**
 * What a blocked session is asking for.
 *
 * The distinction is the strip's whole reason for colouring the dot: a session
 * title does not tell you whether responding costs three seconds or ten minutes,
 * and this does. Known at every prompt callsite -- see `setSessionPendingPrompt`.
 */
export type PromptKind = 'approval' | 'decision';

/**
 * A session state that wants something from the user.
 *
 * These are the states that get *counted* in the resting strip and that feed the
 * blocked-age. Completion is deliberately not one of them -- see `PriorityState`.
 */
export type WantingState = PromptKind | 'failed';

/**
 * A state the strip will expand and name a session for.
 *
 * Wider than `WantingState`. Starting and finishing are both worth announcing
 * but neither is something the user has to act on, so they must not add to the
 * waiting count or drag the blocked-age down every time a turn begins or ends.
 * They own the priority slot without being wanting states.
 *
 * Naming a session as it *starts* is deliberate teaching: it is the moment the
 * user is most likely to be looking, so it is what tells them this patch of the
 * menu bar is where session state changes show up.
 */
export type PriorityState = WantingState | 'completed' | 'running';

export interface TraySessionInfo {
  sessionId: string;
  title: string;
  workspacePath: string;
  status: 'running' | 'idle' | 'error' | 'completed';
  isStreaming: boolean;
  hasPendingPrompt: boolean;
  hasUnread: boolean;
  /** Timestamp when session completed, used for lingering display */
  completedAt?: number;
  /**
   * When this session most recently entered the running state.
   *
   * Stamped on the transition into running, not on every streaming tick, so the
   * strip names a session once as it starts rather than continuously while it
   * works.
   */
  startedAt?: number;
  /** Provider id (`claude-code`, `openai-codex`, …) for the panel's avatar tile. */
  provider?: string;
  /** Provider-qualified model id; the panel strips the prefix for display. */
  model?: string;
  /** Last activity, so the panel can show a relative time like the in-app popover. */
  updatedAt?: number;
  /** Kanban phase. `complete` sessions are hidden, matching the in-app popover. */
  phase?: string;
  /** Archived sessions are hidden, matching the in-app popover. */
  isArchived?: boolean;
  /** What the open prompt is asking for. Only meaningful with `hasPendingPrompt`. */
  promptKind?: PromptKind;
  /**
   * When this session most recently *entered* a wanting state.
   *
   * Not `updatedAt`: a blocked session still emits activity, and the strip's age
   * has to mean "how long has this been waiting", not "how long since it last
   * said anything". It is also what makes "a name is only news once" expressible
   * -- a session that stays blocked keeps the same value, so it is never renamed.
   */
  wantingSince?: number;
}

export interface FleetPriority {
  sessionId: string;
  title: string;
  workspacePath: string;
  state: PriorityState;
  /** When this session entered `state`. */
  since: number;
}

export interface FleetSnapshot {
  running: number;
  /** Tool permission / commit proposal pending -- a tap. */
  needsApproval: number;
  /** AskUserQuestion / ExitPlanMode / PromptForUserInput pending -- thinking required. */
  needsDecision: number;
  failed: number;
  unread: number;
  /** The session that most recently entered a wanting state, if any. */
  priority?: FleetPriority;
  /** Oldest `since` across wanting sessions; the age the strip shows while anything waits. */
  oldestWantingSince?: number;
  /** Newest activity anywhere in the fleet; the age the quiet strip shows. */
  lastActivityAt?: number;
  /** Monotonic. Lets a renderer drop a snapshot that arrives out of order. */
  revision: number;
}

/** Past this, a blocked session is a stall you did not notice, and the age escalates. */
export const AGE_HOT_MS = 60 * 60_000;

export function emptyFleetSnapshot(revision = 0): FleetSnapshot {
  return { running: 0, needsApproval: 0, needsDecision: 0, failed: 0, unread: 0, revision };
}

/** How urgent each state is, for tie-breaking the priority slot. */
const STATE_URGENCY: Record<PriorityState, number> = {
  failed: 4,
  decision: 3,
  approval: 2,
  completed: 1,
  running: 0,
};

/**
 * Whether a session wants something, and what.
 *
 * `error` outranks a pending prompt: a session that failed while a prompt was
 * open is not waiting on an answer any more, it is broken. `groupTraySessions`
 * puts both in the same bucket so the order is invisible there; here it decides
 * which number the session is counted in, so it has to be stated.
 */
function wantingStateOf(session: TraySessionInfo): WantingState | null {
  if (session.status === 'error') return 'failed';
  if (session.hasPendingPrompt) return session.promptKind === 'decision' ? 'decision' : 'approval';
  return null;
}

/**
 * Derive the snapshot both ambient surfaces render.
 *
 * `revision` is an input rather than an internal counter so this stays pure --
 * the caller owns the monotonic sequence.
 *
 * `lastActivityAt` is a floor supplied by the caller because the session cache
 * is not a history: completed sessions are evicted after a minute, so on a quiet
 * machine there is nothing left to read a "how long has it been" age off -- which
 * is exactly when that age matters, since it is what tells idle from broken.
 */
export function deriveFleetSnapshot(
  sessions: Iterable<TraySessionInfo>,
  revision: number,
  options: { lastActivityAt?: number } = {},
): FleetSnapshot {
  const snapshot = emptyFleetSnapshot(revision);
  let priority: FleetPriority | undefined;
  let oldestWantingSince: number | undefined;
  let lastActivityAt: number | undefined = options.lastActivityAt;

  const considerPriority = (session: TraySessionInfo, state: PriorityState, since: number) => {
    if (!priority || beatsPriority(session, state, since, priority)) {
      priority = {
        sessionId: session.sessionId,
        title: session.title || 'Untitled Session',
        workspacePath: session.workspacePath,
        state,
        since,
      };
    }
  };

  for (const session of sessions) {
    if (session.isArchived) continue;

    const activity = session.updatedAt ?? session.completedAt;
    if (activity !== undefined && (lastActivityAt === undefined || activity > lastActivityAt)) {
      lastActivityAt = activity;
    }

    const state = wantingStateOf(session);
    if (state) {
      if (state === 'failed') snapshot.failed += 1;
      else if (state === 'decision') snapshot.needsDecision += 1;
      else snapshot.needsApproval += 1;

      const since = session.wantingSince ?? session.updatedAt ?? 0;
      if (oldestWantingSince === undefined || since < oldestWantingSince) {
        oldestWantingSince = since;
      }
      considerPriority(session, state, since);
      continue;
    }

    if (session.status === 'running') {
      // An agent sets phase `complete` just before its closing output, so this
      // may only suppress the running bucket -- never an unread or prompting
      // session. Mirrors groupTraySessions and agentSessionAttentionAtom.
      if (session.phase !== 'complete') {
        snapshot.running += 1;
        // Same guard as `completedAt` below: only a start this process actually
        // observed is nameable, so restoring the cache never announces a batch
        // of sessions as though they had all just begun.
        if (session.startedAt !== undefined) {
          considerPriority(session, 'running', session.startedAt);
        }
      }
      continue;
    }

    // A finished session is worth naming, but is not waiting on anything -- it
    // takes no count and does not touch `oldestWantingSince`. `completedAt` is
    // stamped only by a live `session:completed`, which is what keeps the rows
    // seeded from the database at startup from each claiming a name on launch.
    if (session.status === 'completed' && session.completedAt !== undefined) {
      considerPriority(session, 'completed', session.completedAt);
    }

    if (session.hasUnread) snapshot.unread += 1;
  }

  if (priority) snapshot.priority = priority;
  if (oldestWantingSince !== undefined) snapshot.oldestWantingSince = oldestWantingSince;
  if (lastActivityAt !== undefined) snapshot.lastActivityAt = lastActivityAt;
  return snapshot;
}

/**
 * The priority slot goes to the session that just transitioned, so every
 * expansion of the strip coincides with something that actually happened.
 * Ties (two sessions blocking in the same millisecond) fall back to the more
 * urgent state, then to the session id purely so the result is deterministic.
 */
function beatsPriority(
  session: TraySessionInfo,
  state: PriorityState,
  since: number,
  incumbent: FleetPriority,
): boolean {
  if (since !== incumbent.since) return since > incumbent.since;
  if (STATE_URGENCY[state] !== STATE_URGENCY[incumbent.state]) {
    return STATE_URGENCY[state] > STATE_URGENCY[incumbent.state];
  }
  return session.sessionId > incumbent.sessionId;
}

/**
 * Minute-granularity age.
 *
 * Deliberately not seconds: the age is the one element allowed to change without
 * a real transition, and a ticking second counter is 60x the redraws to say the
 * same thing -- plus motion in peripheral vision pulls the eye off whatever you
 * were doing.
 */
export function formatFleetAge(elapsedMs: number): string {
  const minutes = Math.max(0, Math.floor(elapsedMs / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h${String(minutes % 60).padStart(2, '0')}m`;
  return `${Math.floor(hours / 24)}d`;
}
