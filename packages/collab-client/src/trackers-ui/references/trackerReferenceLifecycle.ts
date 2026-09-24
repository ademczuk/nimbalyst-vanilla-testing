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

const SETTLED_VALUES = new Set(['accepted', 'approved']);
const WAITING_VALUES = new Set(['proposed', 'in-review', 'changes-requested', 'disputed']);
const PARKED_VALUES = new Set(['superseded', 'abandoned', 'deferred', 'withdrawn']);
const OPEN_VALUES = new Set(['open', 'draft']);

/** Tone of a status. `type` is accepted so per-kind exceptions have one home. */
export function stateTone(_type: string, status: StateToneInput | null | undefined): StateTone {
  if (!status) return 'open';
  const { value, category } = status;
  if (SETTLED_VALUES.has(value) || category === 'done') return 'settled';
  if (value === 'rejected') return 'negative';
  if (PARKED_VALUES.has(value)) return 'parked';
  if (WAITING_VALUES.has(value)) return 'waiting';
  if (OPEN_VALUES.has(value)) return 'open';
  if (category === 'started') return 'active';
  if (category === 'cancelled' || category === 'backlog') return 'parked';
  return 'open';
}

/** Kinds whose resting state is uninteresting, and that resting state. */
const NORMAL_STATE: Record<string, ReadonlySet<string>> = {
  claim: new Set(['asserted']),
  finding: new Set(['active']),
  entity: new Set(['active']),
};

/** True when the header should show the kind alone ("Claim", not "Claim · Asserted"). */
export function isNormalState(type: string, value: string | null | undefined): boolean {
  if (!value) return Boolean(NORMAL_STATE[type]);
  return NORMAL_STATE[type]?.has(value) ?? false;
}

export type BoxBorder = 'dashed' | 'solid' | 'bare';

/** Dashed while not settled; solid once settled; no fill when parked or rejected. */
export function boxBorder(tone: StateTone, normal: boolean): BoxBorder {
  if (normal || tone === 'settled') return 'solid';
  if (tone === 'parked' || tone === 'negative') return 'bare';
  return 'dashed';
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

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

const MEANINGS: Record<string, string> = {
  proposed: 'Open for discussion again',
  accepted: 'Settled. You are recorded as deciding.',
  superseded: 'Replaced by a later decision',
  open: 'Nobody is working on it yet',
  investigating: 'Someone is working it out',
  reopened: 'The answer no longer holds',
  blocked: 'Waiting on something else',
  abandoned: 'Stopped; kept for the record',
  draft: 'Still being written',
  'in-review': 'Waiting on reviewers',
  'changes-requested': 'Back to the author',
  approved: 'Reviewers agreed',
  building: 'Being built',
  shipped: 'Done and released',
};

const VERBS: Record<string, string> = {
  accepted: 'accepted',
  rejected: 'rejected',
  answered: 'answered',
  deferred: 'deferred',
  abandoned: 'abandoned',
  superseded: 'superseded',
  approved: 'approved',
  shipped: 'shipped',
  reopened: 'reopened',
};

const WHY_NOT_PROMPT: TransitionPrompt = {
  field: 'whyNot',
  label: 'Why not? Shown on the page and under "What we decided not to do".',
  placeholder: 'What rules it out',
  confirmLabel: 'Reject',
};

const REVISIT_PROMPT: TransitionPrompt = {
  field: 'revisitWhen',
  label: 'When should we revisit it?',
  placeholder: 'After the beta, or a date',
  confirmLabel: 'Defer',
};

const SUPERSEDE_PROMPT: TransitionPrompt = {
  field: 'supersededBy',
  label: 'Replaced by which item? Enter its key.',
  placeholder: 'SEC-57',
  confirmLabel: 'Supersede',
};

/** Past-tense verb for a change to `value`: "accepted", or "moved this to Building". */
export function verbForStatus(value: string, label: string): string {
  return VERBS[value] ?? `moved this to ${label}`;
}

function statusTransition(type: string, option: TrackerReferenceStatusOption): StateTransition {
  const transition: StateTransition = {
    id: `status:${option.value}`,
    label: option.label,
    tone: stateTone(type, option),
    toStatus: option.value,
    verb: verbForStatus(option.value, option.label),
  };
  const meaning = MEANINGS[option.value];
  if (meaning) transition.description = meaning;
  if (option.value === 'accepted' || option.value === 'rejected') transition.recordsDecision = true;
  if (option.value === 'rejected') {
    transition.prompt = WHY_NOT_PROMPT;
    transition.description = 'Asks why not';
  }
  if (option.value === 'deferred') {
    transition.prompt = REVISIT_PROMPT;
    transition.description = 'Asks when to revisit';
  }
  if (option.value === 'superseded' && type === 'wiki-decision') {
    transition.prompt = SUPERSEDE_PROMPT;
    transition.description = 'Asks for the replacement';
  }
  return transition;
}

/**
 * The valid next states from the current one, in menu order. A question is
 * answered from the box only by accepting its proposed position; writing a new
 * one is a text edit, so that row opens the item.
 */
export function stateTransitions(context: TransitionContext): StateTransition[] {
  const { type, status, statusOptions } = context;
  const others = statusOptions.filter((option) => option.value !== status);
  if (type !== 'question') return others.map((option) => statusTransition(type, option));

  const rows: StateTransition[] = [];
  const hasProposal = context.positionState === 'proposed' && Boolean(context.position?.trim());
  if (status !== 'answered' && hasProposal && others.some((option) => option.value === 'answered')) {
    const owner = context.positionOwnerName ? `${context.positionOwnerName}'s` : 'the proposed';
    rows.push({
      id: 'accept-position',
      label: `Answered: accept ${owner} position`,
      description: `"${context.position!.trim()}" You are recorded as deciding.`,
      tone: 'settled',
      toStatus: 'answered',
      extra: { positionState: 'accepted' },
      recordsDecision: true,
      verb: 'answered',
    });
  }
  if (status !== 'answered' && context.canOpenItem) {
    rows.push({
      id: 'write-position',
      label: hasProposal ? 'Write a different position...' : 'Write a position...',
      description: 'Opens the question',
      tone: 'open',
      toStatus: null,
      opensItem: true,
      verb: '',
    });
  }
  // Plain "Answered" is not offered: an answer without a position is not one.
  const rest = others
    .filter((option) => option.value !== 'answered')
    .map((option) => statusTransition(type, option));
  if (rows.length > 0 && rest.length > 0) rest[0] = { ...rest[0], separatorBefore: true };
  return [...rows, ...rest];
}

export interface TransitionActor {
  email: string;
  name?: string;
}

/** The field updates a transition writes. `today` is `YYYY-MM-DD`. */
export function transitionUpdates(
  transition: StateTransition,
  options: { actor: TransitionActor | null; today: string; input?: string },
): Record<string, unknown> {
  if (transition.toStatus === null) return {};
  const updates: Record<string, unknown> = { status: transition.toStatus, ...transition.extra };
  if (transition.recordsDecision && options.actor) {
    updates.decidedBy = options.actor.email;
    updates.decidedAt = options.today;
  }
  const input = options.input?.trim() ?? '';
  // `input` for a replacement is the resolved item id, stored as a relationship.
  if (transition.prompt) updates[transition.prompt.field] = transition.prompt.field === 'supersededBy' ? { itemId: input } : input;
  return updates;
}

/** The status an agent-created item takes when a person deletes the proposal. */
export function cancelledStatus(statusOptions: readonly TrackerReferenceStatusOption[]): string | null {
  return statusOptions.find((option) => option.category === 'cancelled')?.value ?? null;
}

export interface AgentProposal {
  by: string;
  kind: 'create' | 'status';
  toStatus?: string;
  reason?: string;
  at?: string;
}

export function readAgentProposal(value: unknown): AgentProposal | null {
  if (!value || typeof value !== 'object') return null;
  const proposal = value as Partial<AgentProposal>;
  if (typeof proposal.by !== 'string') return null;
  if (proposal.kind !== 'create' && proposal.kind !== 'status') return null;
  if (proposal.kind === 'status' && typeof proposal.toStatus !== 'string') return null;
  return proposal as AgentProposal;
}

/**
 * The transition Apply runs for a status proposal: the same row the menu would
 * offer, so a question moved to answered also accepts its position.
 */
export function transitionForProposal(
  transitions: readonly StateTransition[],
  toStatus: string,
): StateTransition | null {
  return transitions.find((transition) => transition.toStatus === toStatus && !transition.opensItem) ?? null;
}

/** "Sep 23" from `YYYY-MM-DD` (or an ISO timestamp), without a timezone shift. */
export function shortDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(match[2]) - 1];
  return month ? `${month} ${Number(match[3])}` : null;
}

/** A person's display name: the host's, else the email's local part. */
export function personLabel(
  resolver: { personName?(email: string): string | null },
  email: unknown,
): string | null {
  if (typeof email !== 'string' || email.trim() === '') return null;
  return resolver.personName?.(email) ?? email.split('@')[0];
}

export function todayIso(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
