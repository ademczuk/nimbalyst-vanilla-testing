/**
 * Runs accepted ontology changes through the tracker write path every tracker
 * surface uses (`create-item`, `update-item`, `archive-item`) and records how to
 * reverse them on the proposal. Nothing is ever deleted: a created page is
 * archived on undo, a merged page is archived on apply.
 *
 * A write that fails part-way still records the undo for the writes that ran,
 * so a half-applied change can always be reversed.
 */
import type { TrackerDataCommand } from '../../trackers/dataSource';
import type { KnowledgeGraph } from './ontologyKnowledge';
import { type OntologyRecordLike } from './ontologyRecords';
import { type OntologyChange, type PlanEnv, type ProposalRequestDraft, type ProposalStatus } from './ontologyProposals';
export type TrackerCommandFn = (command: TrackerDataCommand) => Promise<unknown>;
export interface WriteContext {
    command: TrackerCommandFn;
    /** The project new items are created in. */
    workspace: string;
    actor: string | null;
    now: () => Date;
}
export interface ProposalWriteResult {
    status: ProposalStatus;
    applied: string[];
    blocked: Array<{
        changeId: string;
        reason: string;
    }>;
    undone: string[];
    error: string | null;
}
/** Records the reader's accept or reject on the proposal. */
export declare function saveDecisions(context: WriteContext, proposalId: string, changes: readonly OntologyChange[]): Promise<ProposalStatus>;
/**
 * Applies every accepted change that is not live yet. Blocked changes (a
 * schema change the agent has not made) are skipped and reported; the rest
 * run in order.
 */
export declare function applyAcceptedChanges<T extends OntologyRecordLike>(proposal: OntologyRecordLike, graph: KnowledgeGraph<T>, env: PlanEnv, context: WriteContext): Promise<ProposalWriteResult>;
/** Reverses every applied change that has not been undone, latest first. */
export declare function undoAppliedChanges(proposal: OntologyRecordLike, context: WriteContext): Promise<ProposalWriteResult>;
/**
 * What Improve and Suggest structure write: a `proposed` proposal with no
 * changes and a request an agent picks up and drafts. Returns the new item id.
 */
export declare function createProposalRequest(context: WriteContext, draft: ProposalRequestDraft, id: string): Promise<string>;
