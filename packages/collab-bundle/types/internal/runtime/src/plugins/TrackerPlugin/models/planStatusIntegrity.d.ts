export declare const PLAN_STATUS_DRIFT_SIGNAL_KIND: "plan-status-drift";
export declare const PLAN_INVALID_STATUS_SIGNAL_KIND: "plan-invalid-status";
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
export declare function derivePlanStatusSignals(input: PlanStatusSignalInput): TrackerDerivedSignal[];
export interface ProjectedPlanStatusNormalization {
    status: string;
    valid: boolean;
    normalizedFrom?: string;
}
/**
 * Validate a plan status against the active schema and normalize only known,
 * unambiguous aliases. Unknown values remain intact so projection never guesses
 * at the author's intent.
 */
export declare function normalizePlanStatusForProjection(rawStatus: string, validStatuses: readonly string[]): ProjectedPlanStatusNormalization;
export {};
