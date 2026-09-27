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
import { ontologyFieldValue, type OntologyRecordLike } from './ontologyRecords';
import {
  ONTOLOGY_PROPOSAL_TYPE,
  decisionOf,
  deriveProposalStatus,
  isLive,
  parseProposalChanges,
  parseUndoRecord,
  planOntologyChange,
  serializeChanges,
  serializeUndoRecord,
  type ApplyOp,
  type OntologyChange,
  type PlanEnv,
  type ProposalRequestDraft,
  type ProposalStatus,
  type UndoEntry,
  type UndoOp,
} from './ontologyProposals';

export type TrackerCommandFn = (command: TrackerDataCommand) => Promise<unknown>;

export interface WriteContext {
  command: TrackerCommandFn;
  /** The project new items are created in. */
  workspace: string;
  actor: string | null;
  now: () => Date;
}

function toCommand(op: ApplyOp, workspace: string): TrackerDataCommand {
  switch (op.op) {
    case 'update': return { type: 'update-item', input: { itemId: op.itemId, updates: op.updates, sharing: 'team' } };
    case 'archive': return { type: 'archive-item', itemId: op.itemId, archive: true };
    case 'create': return {
      type: 'create-item',
      item: { ...op.item, priority: 'medium', workspace, sharing: 'team' },
    };
  }
}

function undoCommand(op: UndoOp): TrackerDataCommand {
  switch (op.op) {
    case 'restore-fields': {
      const updates: Record<string, unknown> = {};
      for (const [name, value] of Object.entries(op.fields)) updates[name] = value === undefined ? null : value;
      return { type: 'update-item', input: { itemId: op.itemId, updates, sharing: 'team' } };
    }
    case 'archive': return { type: 'archive-item', itemId: op.itemId, archive: true };
    case 'unarchive': return { type: 'archive-item', itemId: op.itemId, archive: false };
  }
}

export interface ProposalWriteResult {
  status: ProposalStatus;
  applied: string[];
  blocked: Array<{ changeId: string; reason: string }>;
  undone: string[];
  error: string | null;
}

async function saveProposal(context: WriteContext, proposalId: string, changes: readonly OntologyChange[], undo: { entries: UndoEntry[] }): Promise<ProposalStatus> {
  const status = deriveProposalStatus(changes);
  await context.command({
    type: 'update-item',
    input: { itemId: proposalId, updates: { changes: serializeChanges(changes), undo: serializeUndoRecord(undo), status }, sharing: 'team' },
  });
  return status;
}

/** Records the reader's accept or reject on the proposal. */
export async function saveDecisions(context: WriteContext, proposalId: string, changes: readonly OntologyChange[]): Promise<ProposalStatus> {
  const status = deriveProposalStatus(changes);
  await context.command({
    type: 'update-item',
    input: { itemId: proposalId, updates: { changes: serializeChanges(changes), status }, sharing: 'team' },
  });
  return status;
}

/**
 * Applies every accepted change that is not live yet. Blocked changes (a
 * schema change the agent has not made) are skipped and reported; the rest
 * run in order.
 */
export async function applyAcceptedChanges<T extends OntologyRecordLike>(
  proposal: OntologyRecordLike,
  graph: KnowledgeGraph<T>,
  env: PlanEnv,
  context: WriteContext,
): Promise<ProposalWriteResult> {
  const { changes: parsed } = parseProposalChanges(ontologyFieldValue(proposal, 'changes'));
  const undo = parseUndoRecord(ontologyFieldValue(proposal, 'undo'));
  const changes = parsed.map((change) => ({ ...change })) as OntologyChange[];
  const result: ProposalWriteResult = { status: 'proposed', applied: [], blocked: [], undone: [], error: null };

  for (const change of changes) {
    if (decisionOf(change) !== 'accepted' || isLive(change)) continue;
    const plan = planOntologyChange(change, graph, env);
    if (plan.blocked) {
      result.blocked.push({ changeId: change.id, reason: plan.blocked });
      continue;
    }
    const at = context.now().toISOString();
    let executed = 0;
    try {
      for (const op of plan.ops) {
        await context.command(toCommand(op, context.workspace));
        executed += 1;
      }
    } catch (cause) {
      result.error = `${change.id}: ${cause instanceof Error ? cause.message : String(cause)}`;
    }
    // `plan.undo[j]` reverses `plan.ops[ops.length - 1 - j]`: the writes that ran are the last `executed` entries.
    const ranUndo = plan.undo.slice(plan.undo.length - executed);
    if (executed > 0) {
      undo.entries.push({ changeId: change.id, appliedAt: at, ...(context.actor ? { appliedBy: context.actor } : {}), ops: ranUndo });
    }
    if (result.error) {
      if (executed > 0) change.reason = `${change.reason ? `${change.reason}\n` : ''}Partly applied (${executed} of ${plan.ops.length} writes) before an error; undo reverses what ran.`;
      break;
    }
    change.appliedAt = at;
    delete change.undoneAt;
    result.applied.push(change.id);
  }

  result.status = await saveProposal(context, proposal.id, changes, undo);
  return result;
}

/** Reverses every applied change that has not been undone, latest first. */
export async function undoAppliedChanges(proposal: OntologyRecordLike, context: WriteContext): Promise<ProposalWriteResult> {
  const { changes: parsed } = parseProposalChanges(ontologyFieldValue(proposal, 'changes'));
  const undo = parseUndoRecord(ontologyFieldValue(proposal, 'undo'));
  const changes = parsed.map((change) => ({ ...change })) as OntologyChange[];
  const result: ProposalWriteResult = { status: 'proposed', applied: [], blocked: [], undone: [], error: null };
  const at = context.now().toISOString();

  for (const entry of [...undo.entries].reverse()) {
    if (entry.undoneAt) continue;
    try {
      for (const op of entry.ops) await context.command(undoCommand(op));
    } catch (cause) {
      result.error = `${entry.changeId}: ${cause instanceof Error ? cause.message : String(cause)}`;
      break;
    }
    entry.undoneAt = at;
    result.undone.push(entry.changeId);
    const change = changes.find((candidate) => candidate.id === entry.changeId);
    if (change && !undo.entries.some((other) => other.changeId === entry.changeId && !other.undoneAt)) change.undoneAt = at;
  }
  // Schema changes an agent applied have no undo entry; undo leaves them in place and says so by status.
  result.status = await saveProposal(context, proposal.id, changes, undo);
  return result;
}

/**
 * What Improve and Suggest structure write: a `proposed` proposal with no
 * changes and a request an agent picks up and drafts. Returns the new item id.
 */
export async function createProposalRequest(context: WriteContext, draft: ProposalRequestDraft, id: string): Promise<string> {
  await context.command({
    type: 'create-item',
    item: {
      id,
      type: ONTOLOGY_PROPOSAL_TYPE,
      title: draft.title,
      status: 'proposed',
      priority: 'medium',
      workspace: context.workspace,
      sharing: 'team',
      customFields: { request: draft.request, healthCheck: draft.healthCheck, changes: '[]' },
    },
  });
  return id;
}
