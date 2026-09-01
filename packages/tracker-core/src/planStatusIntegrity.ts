/** Pure plan-status signals shared by every tracker host. */
export const PLAN_STATUS_DRIFT_SIGNAL_KIND = 'plan-status-drift' as const;
export const PLAN_INVALID_STATUS_SIGNAL_KIND = 'plan-invalid-status' as const;

export type StalePlanStatus = 'draft' | 'ready-for-development';

export interface PlanStatusDriftSignal {
  kind: typeof PLAN_STATUS_DRIFT_SIGNAL_KIND;
  reason: 'linked-session-committed';
  status: StalePlanStatus;
  committedSessionIds: string[];
  commitShas: string[];
}

export interface InvalidPlanStatusSignal {
  kind: typeof PLAN_INVALID_STATUS_SIGNAL_KIND;
  reason: 'unrecognized-status';
  status: string;
  validStatuses: string[];
}

export type TrackerDerivedSignal = PlanStatusDriftSignal | InvalidPlanStatusSignal;

interface LinkedCommitEvidence {
  sha: string;
  sessionId?: string;
}

export interface PlanStatusSignalInput {
  primaryType: string;
  status: unknown;
  linkedCommits?: readonly LinkedCommitEvidence[];
}

/**
 * Derive read-only plan integrity signals from evidence already carried by the
 * item. CommitTrackerLinker includes the originating session id only on commits
 * reached through a session link, so this needs no session or database lookup.
 * Synced items intentionally omit linkedSessions because session ids are local,
 * private metadata and must not enter shared tracker state. The sessionId on a
 * linked commit is therefore the item-side proof that a linked session committed.
 */
export function derivePlanStatusSignals(input: PlanStatusSignalInput): TrackerDerivedSignal[] {
  if (input.primaryType !== 'plan') return [];
  if (input.status !== 'draft' && input.status !== 'ready-for-development') return [];

  const committedSessionIds = new Set<string>();
  const commitShas = new Set<string>();
  const linkedCommits = Array.isArray(input.linkedCommits) ? input.linkedCommits : [];
  for (const commit of linkedCommits) {
    if (!commit.sessionId) continue;
    committedSessionIds.add(commit.sessionId);
    commitShas.add(commit.sha);
  }

  if (committedSessionIds.size === 0) return [];

  return [{
    kind: PLAN_STATUS_DRIFT_SIGNAL_KIND,
    reason: 'linked-session-committed',
    status: input.status,
    committedSessionIds: [...committedSessionIds],
    commitShas: [...commitShas],
  }];
}

export interface ProjectedPlanStatusNormalization {
  status: string;
  valid: boolean;
  normalizedFrom?: string;
}

/** Known, semantics-preserving aliases accepted only at the projection boundary. */
const PLAN_STATUS_ALIASES: Readonly<Record<string, string>> = {
  complete: 'completed',
};

/**
 * Validate a plan status against the active schema and normalize only known,
 * unambiguous aliases. Unknown values remain intact so projection never guesses
 * at the author's intent.
 */
export function normalizePlanStatusForProjection(
  rawStatus: string,
  validStatuses: readonly string[],
): ProjectedPlanStatusNormalization {
  const normalizedInput = rawStatus.trim().toLowerCase();
  const canonical = validStatuses.find((value) => value.toLowerCase() === normalizedInput);
  if (canonical) {
    return canonical === rawStatus
      ? { status: canonical, valid: true }
      : { status: canonical, valid: true, normalizedFrom: rawStatus };
  }

  const aliasTarget = PLAN_STATUS_ALIASES[normalizedInput];
  if (aliasTarget && validStatuses.includes(aliasTarget)) {
    return { status: aliasTarget, valid: true, normalizedFrom: rawStatus };
  }

  return { status: rawStatus, valid: false };
}
