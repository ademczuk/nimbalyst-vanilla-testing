/**
 * The triage inbox: which items still need a human decision.
 *
 * "Untriaged" is defined by the *absence* of every triage act rather than by a
 * dedicated status, so items arriving from any source -- GitHub imports, inline
 * captures, agent-filed bugs, hand-typed tasks -- land in the inbox without any
 * type needing a `needs-triage` value in its schema. Triaging an item is
 * whatever the user does to it: assign it, prioritize it, put it in a
 * milestone, or move it off its initial status. Any one of those retires it
 * from the inbox.
 *
 * Snoozing is personal (one triager deferring an item must not hide it from
 * their colleague), so deadlines arrive through the context rather than living
 * on the record.
 *
 * Pure and I/O-free: record accessors are injected the same way
 * `computeCollectionRollup` takes `getStatus`, so the CLI, the MCP tools, and
 * the renderer all evaluate the same predicate.
 */
import type { TrackerRecord } from '../../../core/TrackerRecord';
/** Whether the inbox spans every type or only the selected one. */
export type InboxScope = 'global' | 'type';
/** Record accessors the predicate needs, injected to keep this module pure. */
export interface InboxSignals {
    getStatus: (record: TrackerRecord) => string;
    getPriority: (record: TrackerRecord) => string;
    /** Falsy when the item has no assignee. */
    getAssignee: (record: TrackerRecord) => unknown;
}
export interface InboxContext extends InboxSignals {
    /** Personal snooze deadlines (epoch ms) by item id. */
    snoozedUntilByItemId?: ReadonlyMap<string, number>;
    /** Injectable clock so snooze expiry is testable. */
    nowMs?: number;
    /** `type` restricts the inbox to `selectedType`; `global` spans all types. */
    scope?: InboxScope;
    /** The sidebar's selected type; ignored when scope is `global` or `'all'`. */
    selectedType?: string;
}
/**
 * An item an agent filed on its own initiative. The inbox surfaces these
 * distinctly: the house rule is that an agent may propose, only a human accepts.
 */
export declare function isAgentProposal(record: TrackerRecord): boolean;
/** The initial workflow status: explicit default, then first lifecycle option. */
export declare function getInitialStatus(type: string): string;
/**
 * The priority every write path stamps when the caller doesn't pick one --
 * `tracker_create`, the inline/plan/decision capture paths, and the frontmatter
 * projection all write `priority || 'medium'`. The predicate has to know that
 * value: without it a stamp is indistinguishable from a human choosing Medium,
 * every item counts as prioritized, and the inbox is empty forever (NIM-2172).
 */
export declare const STAMPED_DEFAULT_PRIORITY = "medium";
/**
 * The priority value that means "nobody decided": the type's declared default,
 * falling back to the stamp for a type that declares none -- such a type is
 * still receiving the stamp on create, so the stamp is its de-facto default.
 */
export declare function getDefaultPriority(type: string): string;
/** Whether an item belongs to at least one collection (milestone / release). */
export declare function isInCollection(record: TrackerRecord): boolean;
export interface TriageSignals {
    assigned: boolean;
    /** Given a priority other than the one the write paths stamp by default. */
    prioritized: boolean;
    inCollection: boolean;
    /** Moved off the type's initial status (or the type has no default at all). */
    statusMoved: boolean;
    /** Explicitly marked "looked at, correctly where it is" by a person. */
    markedTriaged: boolean;
}
/** The individual acts that retire an item from the inbox. */
export declare function triageSignals(record: TrackerRecord, signals: InboxSignals): TriageSignals;
/**
 * Whether an item still needs triage. Archived items and collections themselves
 * are never in the inbox -- archiving *is* the dismiss action, and a milestone
 * is the destination of triage, not its subject.
 */
export declare function isUntriaged(record: TrackerRecord, signals: InboxSignals): boolean;
/** Whether a personal snooze is still holding this item out of the inbox. */
export declare function isSnoozed(record: TrackerRecord, snoozedUntilByItemId: ReadonlyMap<string, number> | undefined, nowMs: number): boolean;
/**
 * The inbox queue: untriaged, un-snoozed items, newest first so the freshest
 * arrivals are processed while their context is still warm.
 */
export declare function selectInboxItems(items: TrackerRecord[], ctx: InboxContext): TrackerRecord[];
/**
 * The status "accept" moves an item to: the first option after the type's
 * initial status. Schemas order their status options as a lifecycle, so the
 * next option is the working state (`to-do` -> `in-progress`). Returns null when
 * the type has no status options or the initial status is already the last one.
 */
export declare function acceptStatusFor(type: string): string | null;
/** Priority values a type offers, in schema order (lowest first). */
export declare function priorityOptionsFor(type: string): string[];
/** Common snooze offsets, in ms, for the inbox's snooze action. */
export declare const SNOOZE_PRESETS: ReadonlyArray<{
    id: string;
    label: string;
    ms: number;
}>;
/** Inbox size, for the sidebar badge. Same predicate, no sort. */
export declare function countInboxItems(items: TrackerRecord[], ctx: InboxContext): number;
