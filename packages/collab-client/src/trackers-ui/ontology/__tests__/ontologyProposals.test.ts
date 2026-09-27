// @vitest-environment node
import { expect, test } from 'vitest';
import type { TrackerDataCommand } from '../../../trackers/dataSource';
import { buildKnowledgeGraph, computeContentHealth } from '../ontologyKnowledge';
import {
  decideChange,
  deriveProposalStatus,
  parseProposalChanges,
  planOntologyChange,
  proposalRequestFor,
  type OntologyChange,
  type PlanEnv,
} from '../ontologyProposals';
import type { OntologyRecordLike } from '../ontologyRecords';
import { applyAcceptedChanges, undoAppliedChanges, type WriteContext } from '../ontologyWriter';
import { claim, knowledgeFixture, NOW, rec } from './ontologyFixture';

let ids = 0;
const env = (kinds: string[] = ['product', 'market', 'topic', 'concept', 'area', 'organization']): PlanEnv => ({
  kindOptions: new Set(kinds),
  predicateLabel: (id) => id.replace(/-/g, ' '),
  newId: () => `new-${++ids}`,
});

/** The tracker write path as the room applies it, over plain records. */
function room(records: OntologyRecordLike[]) {
  const byId = new Map(records.map((record) => [record.id, structuredClone(record)]));
  const log: string[] = [];
  const command = async (input: TrackerDataCommand) => {
    if (input.type === 'update-item') {
      const target = byId.get(input.input.itemId);
      if (!target) throw new Error(`no item ${input.input.itemId}`);
      for (const [name, value] of Object.entries(input.input.updates)) {
        if (value === null) delete target.fields[name];
        else target.fields[name] = value;
      }
    } else if (input.type === 'create-item') {
      const { id, type, title, status, customFields } = input.item;
      byId.set(id, { id, primaryType: type, fields: { title, status, ...customFields }, system: {} });
    } else if (input.type === 'archive-item') {
      byId.get(input.itemId)!.archived = input.archive;
    } else throw new Error(`unexpected ${input.type}`);
    log.push(input.type);
    return { ok: true as const };
  };
  return { byId, log, command, records: () => [...byId.values()] };
}

const context = (command: WriteContext['command']): WriteContext => ({
  command, workspace: 'project-1', actor: 'me@example.test', now: () => new Date(NOW),
});

function proposal(changes: OntologyChange[]): OntologyRecordLike {
  return rec('P1', 'ontology-proposal', { status: 'proposed', changes: JSON.stringify(changes) });
}

test('each change plans the pages it touches, a before/after, and writes that wait on the schema', () => {
  const graph = buildKnowledgeGraph(knowledgeFixture());
  const reclassify = planOntologyChange({ id: 'a', type: 'reclassify-pages', toKind: 'topic', pageIds: ['Pricing', 'Blog strategy', 'missing'] }, graph, env());
  expect(reclassify.pages.map((page) => page.id)).toEqual(['Pricing', 'Blog strategy']);
  expect(reclassify.example).toMatchObject({ itemId: 'Pricing', before: [{ value: 'concept' }], after: [{ value: 'topic' }] });
  expect(reclassify.ops).toHaveLength(2);
  // A kind the schema does not have yet blocks the data change; the schema change itself waits on an agent.
  expect(planOntologyChange({ id: 'a', type: 'reclassify-pages', toKind: 'topic', pageIds: ['Pricing'] }, graph, env(['product'])).blocked).toMatch(/topic/);
  expect(planOntologyChange({ id: 'k', type: 'add-kind-option', value: 'topic', label: 'Topic' }, graph, env())).toMatchObject({ satisfied: true, blocked: null });
  expect(planOntologyChange({ id: 'p', type: 'add-predicate', predicate: { id: 'made-by', label: 'is made by', direction: 'directed', valueShape: 'entity' } }, graph, env()).blocked).toMatch(/agent/);

  const market = planOntologyChange({ id: 'm', type: 'add-market-node', title: 'Agent orchestrator' }, graph, env());
  expect(market.ops).toEqual([{ op: 'create', item: expect.objectContaining({ type: 'entity', title: 'Agent orchestrator', customFields: { kind: 'market', parent: { itemId: 'Markets' } } }) }]);
  expect(planOntologyChange({ id: 'm', type: 'add-market-node', title: 'ai ide' }, graph, env())).toMatchObject({ satisfied: true, ops: [] });

  // Cursor already has a competes-with claim from Nimbalyst, so it gets no second one.
  const move = planOntologyChange({
    id: 'f', type: 'move-field-to-claims', field: 'summary', predicate: 'competes-with', subjectId: 'Nimbalyst', pageIds: ['Cursor', 'Notion', 'Zed'],
    qualifiers: { overlap: 'summary', threat: 'threat' }, staticQualifiers: { reviewedAt: '2026-09-24' },
  }, graph, env());
  expect(move.pages.map((page) => page.id)).toEqual(['Cursor', 'Notion', 'Zed']);
  expect(move.ops.map((op) => op.op === 'create' && op.item.customFields)).toEqual([
    { subject: { itemId: 'Nimbalyst' }, object: { itemId: 'Notion' }, predicate: 'competes-with', basis: 'documented', qualifiers: { reviewedAt: '2026-09-24', overlap: 'docs' } },
    { subject: { itemId: 'Nimbalyst' }, object: { itemId: 'Zed' }, predicate: 'competes-with', basis: 'documented', qualifiers: { reviewedAt: '2026-09-24', overlap: 'editor' } },
  ]);

  expect(parseProposalChanges('[{"type":"reclassify-pages","toKind":"topic"},{"type":"nope"},{"id":"x","type":"add-market-node","title":"T"}]')).toEqual({
    changes: [{ id: 'x', type: 'add-market-node', title: 'T' }],
    errors: ['change 1: needs toKind and pageIds', 'change 2: unknown type "nope"'],
  });

  const request = proposalRequestFor(computeContentHealth(graph, { now: NOW }).find((item) => item.id === 'duplicates')!);
  expect(request).toMatchObject({ healthCheck: 'duplicates', title: 'Improve: 1 likely duplicate' });
  expect(request.request).toContain('- Notion [entity Notion] = notion ai [competitor NIM-1374]');
});

test('apply writes accepted changes through the tracker commands, keeps rejected ones, and undo restores the graph', async () => {
  const initial = knowledgeFixture();
  const store = room([...initial, proposal([
    { id: 'reclassify', type: 'reclassify-pages', toKind: 'topic', pageIds: ['Pricing', 'Blog strategy'] },
    { id: 'merge', type: 'merge-duplicates', keepId: 'Notion', mergeIds: ['NIM-1374'] },
    { id: 'market', type: 'add-market-node', title: 'Agent orchestrator' },
    { id: 'predicate', type: 'add-predicate', predicate: { id: 'inspired-by', label: 'inspired by', direction: 'directed', valueShape: 'entity' } },
    { id: 'no', type: 'reclassify-pages', toKind: 'organization', pageIds: ['Zed'] },
  ])]);
  // The competitor item is referenced by a claim, which the merge must repoint.
  store.byId.set('c20', claim('c20', 'NIM-1374', 'in-market', 'Team wiki'));
  const read = () => parseProposalChanges(store.byId.get('P1')!.fields.changes).changes;

  let changes = read();
  for (const [id, decision] of [['reclassify', 'accepted'], ['merge', 'accepted'], ['market', 'accepted'], ['predicate', 'accepted'], ['no', 'rejected']] as const) {
    changes = decideChange(changes, id, decision, 'me@example.test', '2026-09-24T00:00:00Z', id === 'no' ? 'Zed is a product' : undefined);
  }
  expect(deriveProposalStatus(changes)).toBe('accepted');
  store.byId.get('P1')!.fields.changes = JSON.stringify(changes);

  const applied = await applyAcceptedChanges(store.byId.get('P1')!, buildKnowledgeGraph(store.records()), env(), context(store.command));
  expect(applied).toMatchObject({ applied: ['reclassify', 'merge', 'market'], blocked: [{ changeId: 'predicate' }], error: null, status: 'accepted' });
  expect(store.byId.get('Pricing')!.fields.kind).toBe('topic');
  expect(store.byId.get('Notion')!.fields.aliases).toEqual(['Notion AI']);
  expect(store.byId.get('NIM-1374')!.archived).toBe(true);
  expect(store.byId.get('c20')!.fields.subject).toEqual({ itemId: 'Notion' });
  expect(store.records().find((record) => record.fields.title === 'Agent orchestrator')?.fields.kind).toBe('market');
  expect(store.byId.get('Zed')!.fields.kind).toBe('product');
  expect(read().find((change) => change.id === 'no')).toMatchObject({ decision: 'rejected', rejectReason: 'Zed is a product' });

  // An agent adds the predicate and marks it; the proposal is then fully applied.
  store.byId.get('P1')!.fields.changes = JSON.stringify(read().map((change) => (change.id === 'predicate' ? { ...change, appliedAt: '2026-09-24T01:00:00Z' } : change)));
  expect(deriveProposalStatus(read())).toBe('applied');

  const undone = await undoAppliedChanges(store.byId.get('P1')!, context(store.command));
  expect(undone).toMatchObject({ undone: ['market', 'merge', 'reclassify'], error: null, status: 'undone' });
  for (const original of [...initial, claim('c20', 'NIM-1374', 'in-market', 'Team wiki')]) {
    const now = store.byId.get(original.id)!;
    expect({ id: now.id, archived: Boolean(now.archived), fields: now.fields }).toEqual({ id: original.id, archived: Boolean(original.archived), fields: original.fields });
  }
  // Nothing is deleted: the created market page is archived.
  expect(store.records().find((record) => record.fields.title === 'Agent orchestrator')?.archived).toBe(true);
});

test('a write that fails part-way records undo for the writes that ran', async () => {
  const store = room([...knowledgeFixture(), proposal([{ id: 'r', type: 'reclassify-pages', toKind: 'topic', pageIds: ['Blog strategy', 'Pricing'], decision: 'accepted' }])]);
  let calls = 0;
  const failing: WriteContext['command'] = async (input) => {
    if (input.type === 'update-item' && input.input.itemId !== 'P1' && ++calls === 2) throw new Error('room refused');
    return store.command(input);
  };
  const result = await applyAcceptedChanges(store.byId.get('P1')!, buildKnowledgeGraph(store.records()), env(), context(failing));
  expect(result).toMatchObject({ applied: [], error: 'r: room refused', status: 'accepted' });
  expect(store.byId.get('Blog strategy')!.fields.kind).toBe('topic');
  await undoAppliedChanges(store.byId.get('P1')!, context(store.command));
  expect(store.byId.get('Blog strategy')!.fields.kind).toBe('concept');
  expect(store.byId.get('Pricing')!.fields.kind).toBe('concept');
});
