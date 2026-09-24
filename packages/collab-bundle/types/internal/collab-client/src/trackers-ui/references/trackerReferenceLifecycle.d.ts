/**
 * What an embedded tracker box says about an item's state, and how it may
 * change it. Pure: the box, the state menu, and a host's own state line all
 * derive from these, so they cannot disagree about a status.
 *
 * Two encodings only. The state word's tone says what kind of attention the
 * item needs; the box border says whether it is settled.
 */
export interface TrackerReferenceStatusOption {
    value: string;
    label: string;
    color?: string;
    category?: string;
}
export type StateTone = 'settled' | 'active' | 'waiting' | 'negative' | 'parked' | 'open';
export interface StateToneInput {
    value: string;
    category?: string;
}
/** Tone of a status. `type` is accepted so per-kind exceptions have one home. */
export declare function stateTone(_type: string, status: StateToneInput | null | undefined): StateTone;
/** True when the header should show the kind alone ("Claim", not "Claim · Asserted"). */
export declare function isNormalState(type: string, value: string | null | undefined): boolean;
export type BoxBorder = 'dashed' | 'solid' | 'bare';
/** Dashed while not settled; solid once settled; no fill when parked or rejected. */
export declare function boxBorder(tone: StateTone, normal: boolean): BoxBorder;
export interface TransitionPrompt {
    /** `supersededBy` takes an item key, resolved to an item before committing. */
    field: 'whyNot' | 'revisitWhen' | 'supersededBy';
    label: string;
    placeholder: string;
    confirmLabel: string;
}
export interface StateTransition {
    id: string;
    label: string;
    description?: string;
    tone: StateTone;
    /** Null for a row that opens the item instead of changing it. */
    toStatus: string | null;
    /** Fields set alongside the status (a question's positionState). */
    extra?: Record<string, unknown>;
    /** Stamps decidedBy / decidedAt with the actor. */
    recordsDecision?: boolean;
    /** One field the record needs, asked inside the menu before committing. */
    prompt?: TransitionPrompt;
    opensItem?: boolean;
    separatorBefore?: boolean;
    /** Past-tense verb for "You <verb> just now". */
    verb: string;
}
export interface TransitionContext {
    type: string;
    status: string | null;
    statusOptions: readonly TrackerReferenceStatusOption[];
    /** Question only: the proposed position, when there is one to accept. */
    position?: string | null;
    positionState?: string | null;
    /** Display name of whoever proposed the position (the question's owner). */
    positionOwnerName?: string | null;
    canOpenItem?: boolean;
}
/** Past-tense verb for a change to `value`: "accepted", or "moved this to Building". */
export declare function verbForStatus(value: string, label: string): string;
/**
 * The valid next states from the current one, in menu order. A question is
 * answered from the box only by accepting its proposed position; writing a new
 * one is a text edit, so that row opens the item.
 */
export declare function stateTransitions(context: TransitionContext): StateTransition[];
export interface TransitionActor {
    email: string;
    name?: string;
}
/** The field updates a transition writes. `today` is `YYYY-MM-DD`. */
export declare function transitionUpdates(transition: StateTransition, options: {
    actor: TransitionActor | null;
    today: string;
    input?: string;
}): Record<string, unknown>;
/** The status an agent-created item takes when a person deletes the proposal. */
export declare function cancelledStatus(statusOptions: readonly TrackerReferenceStatusOption[]): string | null;
export interface AgentProposal {
    by: string;
    kind: 'create' | 'status';
    toStatus?: string;
    reason?: string;
    at?: string;
}
export declare function readAgentProposal(value: unknown): AgentProposal | null;
/**
 * The transition Apply runs for a status proposal: the same row the menu would
 * offer, so a question moved to answered also accepts its position.
 */
export declare function transitionForProposal(transitions: readonly StateTransition[], toStatus: string): StateTransition | null;
/** "Sep 23" from `YYYY-MM-DD` (or an ISO timestamp), without a timezone shift. */
export declare function shortDate(value: unknown): string | null;
/** A person's display name: the host's, else the email's local part. */
export declare function personLabel(resolver: {
    personName?(email: string): string | null;
}, email: unknown): string | null;
export declare function todayIso(now?: Date): string;
