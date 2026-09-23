/**
 * Classify the data-bearing difference between two resolved tracker schemas as
 * additive (safe, applies instantly) or destructive (needs a confirm carrying a
 * blast radius). Pure: no item storage, no database, no UI.
 *
 * Presentation-only differences (labels, colors, icons, layout, defaults) never
 * affect the classification. Anything that is not a *proven* widening is
 * destructive by default — a wrong "additive" silently invalidates data that is
 * already in items, while a wrong "destructive" only costs a confirm click.
 */
import type { FieldDefinition, FieldOption, FieldType, TrackerDataModel, TrackerSharing } from './TrackerDataModel.js';
export type TrackerSchemaConstraint = 'required' | 'readOnly' | 'minLength' | 'maxLength' | 'min' | 'max' | 'multiValue' | 'allowSelfLink' | 'targetTrackerTypes';
interface FieldChange {
    fieldName: string;
}
export type AdditiveTrackerSchemaChange = (FieldChange & {
    kind: 'field-added';
    field: FieldDefinition;
}) | (FieldChange & {
    kind: 'status-added';
    option: FieldOption;
}) | (FieldChange & {
    kind: 'select-option-added';
    option: FieldOption;
}) | (FieldChange & {
    kind: 'constraint-widened';
    constraint: TrackerSchemaConstraint;
    previousValue: unknown;
    nextValue: unknown;
});
export type DestructiveTrackerSchemaChange = (FieldChange & {
    kind: 'field-removed';
    field: FieldDefinition;
}) | (FieldChange & {
    kind: 'status-removed';
    option: FieldOption;
}) | (FieldChange & {
    kind: 'select-option-removed';
    option: FieldOption;
}) | (FieldChange & {
    kind: 'field-type-changed';
    previousType: FieldType;
    nextType: FieldType;
}) | (FieldChange & {
    kind: 'constraint-narrowed';
    constraint: TrackerSchemaConstraint;
    previousValue: unknown;
    nextValue: unknown;
}) | (FieldChange & {
    kind: 'field-definition-changed';
    previousField: FieldDefinition;
    nextField: FieldDefinition;
}) | {
    kind: 'workflow-status-field-changed';
    previousFieldName: string | undefined;
    nextFieldName: string | undefined;
};
export type TrackerSchemaChange = AdditiveTrackerSchemaChange | DestructiveTrackerSchemaChange;
export declare function isDestructiveTrackerSchemaChange(change: TrackerSchemaChange): change is DestructiveTrackerSchemaChange;
/** The subset a confirm dialog and the blast-radius calculation care about. */
export declare function destructiveTrackerSchemaChanges(changes: readonly TrackerSchemaChange[]): DestructiveTrackerSchemaChange[];
export interface TrackerSchemaRenameCandidate {
    previousFieldName: string;
    nextFieldName: string;
    match: 'exact-definition' | 'compatible-type';
}
export interface TrackerSchemaChangeClassification {
    /**
     * The verdict the write-through path gates on. Kept alongside {@link changes}
     * so the none/additive/destructive precedence is stated once here rather than
     * re-derived (and eventually mis-derived) at each call site. Every other view
     * of the diff — the destructive subset, the additive subset, counts — is a
     * filter of {@link changes}; see {@link destructiveTrackerSchemaChanges}.
     */
    classification: 'none' | 'additive' | 'destructive';
    changes: TrackerSchemaChange[];
    renameCandidates: TrackerSchemaRenameCandidate[];
}
export type TrackerSchemaAffectedItemCounter = (change: DestructiveTrackerSchemaChange) => number | Promise<number>;
export interface TrackerSchemaBlastRadiusEntry {
    change: DestructiveTrackerSchemaChange;
    affectedItemCount: number;
}
/**
 * Classify data-bearing differences between two resolved tracker schemas.
 * A remove-plus-add is reported as exactly that, with any plausible rename
 * surfaced separately in `renameCandidates` — the classifier never guesses that
 * a rename happened, because guessing wrong migrates values onto the wrong field.
 */
export declare function classifyTrackerSchemaChanges(previous: TrackerDataModel, next: TrackerDataModel): TrackerSchemaChangeClassification;
/**
 * Ask a caller-owned data source for the impact of each destructive change.
 * The classifier remains independent of item storage and database backends.
 */
export declare function calculateTrackerSchemaBlastRadius(classification: TrackerSchemaChangeClassification, countAffectedItems: TrackerSchemaAffectedItemCounter): Promise<TrackerSchemaBlastRadiusEntry[]>;
/**
 * D3: anyone can add, admins can remove or rename. The split lands on the same
 * line as the safety evidence — an additive change provably cannot invalidate a
 * teammate's data, a destructive one can.
 */
export type TrackerSchemaActorRole = 'admin' | 'member';
/** A remove-plus-add the caller states outright, so it stops reading as a removal. */
export interface TrackerSchemaRenameIntent {
    previousFieldName: string;
    nextFieldName: string;
}
export interface TrackerSchemaChangeGateInput {
    classification: TrackerSchemaChangeClassification;
    /** Only a team tracker has other people's data behind it. */
    sharing: TrackerSharing | undefined;
    actorRole: TrackerSchemaActorRole;
    /** The caller showed the blast radius and the user approved it. */
    confirmed: boolean;
}
export type TrackerSchemaChangeGateVerdict = {
    allowed: true;
    reason: 'no-change' | 'additive' | 'confirmed';
} | {
    allowed: false;
    /**
     * `requires-admin` outranks `needs-confirmation`: a member's approval is
     * not the approval that was missing, so telling them to confirm would send
     * them round a loop they cannot exit.
     */
    reason: 'needs-confirmation' | 'requires-admin';
    blocking: DestructiveTrackerSchemaChange[];
};
/**
 * The one statement of the rule every write path gates on.
 *
 * Additive and no-change pass unconditionally — no role check, no confirmation,
 * no friction. That is not an oversight to be tightened later: additive edits are
 * the majority of real schema work and are provably safe (unknown fields are
 * preserved byte-for-byte and simply do not render, a removed status is retained
 * as an extra column). Adding ceremony here makes the common case worse for no
 * safety gain.
 */
export declare function resolveTrackerSchemaChangeGate(input: TrackerSchemaChangeGateInput): TrackerSchemaChangeGateVerdict;
/**
 * The sentence the confirm leads with, e.g.
 * `7 items have \`severity\`; 3 are in \`blocked\`.`
 *
 * A zero count still gets a clause. "No items have `severity`" is the answer to
 * the question the user is actually asking, and silence reads as "we didn't check".
 */
export declare function describeTrackerSchemaBlastRadius(entries: readonly TrackerSchemaBlastRadiusEntry[]): string;
export interface TrackerSchemaChangeOption {
    /** Stable id the confirm surface echoes back with the write. */
    id: string;
    kind: 'rename' | 'retire';
    label: string;
    description: string;
    rename?: TrackerSchemaRenameIntent;
}
export interface TrackerSchemaDestructiveConfirmCopy {
    title: string;
    /** {@link describeTrackerSchemaBlastRadius} over the same entries. */
    blastRadius: string;
    message: string;
    /**
     * Rename first, always. A remove-plus-add is indistinguishable from a rename
     * without stated intent, and the user is the only one who holds that intent —
     * so the option that captures it has to be the one they see first, not one
     * they discover after choosing wrong.
     */
    options: TrackerSchemaChangeOption[];
    confirmLabel: string;
}
export declare function describeTrackerSchemaDestructiveChange(input: {
    displayNamePlural: string;
    sharing: TrackerSharing | undefined;
    teamName?: string | null;
    blastRadius: readonly TrackerSchemaBlastRadiusEntry[];
    renameCandidates: readonly TrackerSchemaRenameCandidate[];
}): TrackerSchemaDestructiveConfirmCopy;
export {};
