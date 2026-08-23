// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrackerRecord } from '../../../../core/TrackerRecord';
import { getRecordStatus } from '../../trackerRecordAccessors';
import { loadBuiltinTrackers } from '../ModelLoader';
import { globalRegistry, type TrackerDataModel } from '../TrackerDataModel';
import { computeReadiness } from '../trackerReadiness';

const BLOCKS_ONLY_TYPE = 'readiness-blocks-only-test';

const blocksOnlyModel: TrackerDataModel = {
  type: BLOCKS_ONLY_TYPE,
  displayName: 'Blocks only test',
  displayNamePlural: 'Blocks only tests',
  icon: 'block',
  color: '#000000',
  modes: { inline: true, fullDocument: false },
  idPrefix: 'bot',
  idFormat: 'ulid',
  fields: [
    { name: 'title', type: 'string' },
    {
      name: 'status',
      type: 'select',
      default: 'open',
      options: [
        { value: 'open', label: 'Open', category: 'unstarted' },
        { value: 'closed', label: 'Closed', category: 'done' },
      ],
    },
    {
      name: 'blocks',
      type: 'relationship',
      relationshipTypeKey: 'blocks',
      targetTrackerTypes: '*',
      multiValue: true,
    },
  ],
  roles: { title: 'title', workflowStatus: 'status' },
};

function ensureBugDependencyFields(): void {
  const bug = globalRegistry.get('bug');
  if (!bug || bug.fields.some((field) => field.relationshipTypeKey === 'depends-on')) return;
  globalRegistry.register({
    ...bug,
    fields: [
      ...bug.fields,
      {
        name: 'dependsOn',
        type: 'relationship',
        relationshipTypeKey: 'depends-on',
        targetTrackerTypes: '*',
        multiValue: true,
      },
      {
        name: 'blocks',
        type: 'relationship',
        relationshipTypeKey: 'blocks',
        targetTrackerTypes: '*',
        multiValue: true,
      },
    ],
  });
}

beforeAll(() => {
  loadBuiltinTrackers();
  // Keep this unit test independent of the built-in schema's current field set.
  ensureBugDependencyFields();
  globalRegistry.register(blocksOnlyModel);
});

afterAll(() => {
  globalRegistry.unregister(BLOCKS_ONLY_TYPE);
  globalRegistry.clearWorkspaceSchema('bug');
});

function record(
  id: string,
  primaryType: string,
  fields: Record<string, unknown> = {},
  options: Partial<Pick<TrackerRecord, 'issueKey' | 'localKey' | 'archived'>> = {},
): TrackerRecord {
  const { archived = false, ...identity } = options;
  return {
    id,
    primaryType,
    typeTags: [primaryType],
    ...identity,
    source: 'native',
    archived,
    syncStatus: 'local',
    system: {
      workspace: '/w',
      createdAt: '2026-08-22T00:00:00.000Z',
      updatedAt: '2026-08-22T00:00:00.000Z',
    },
    fields: { title: `Item ${id}`, status: 'to-do', ...fields },
  };
}

describe('computeReadiness', () => {
  it('clears done, cancelled, cross-type, and archived terminal blockers from the full corpus', () => {
    const bug = record('done-bug', 'bug', { status: 'done' });
    const cancelled = record('cancelled-milestone', 'milestone', { status: 'cancelled' });
    const plan = record('completed-plan', 'plan', { status: 'completed' });
    const archived = record('archived-done', 'bug', { status: 'done' }, { archived: true });
    const dependent = record('dependent', 'bug', {
      dependsOn: [bug, cancelled, plan, archived].map((item) => ({ itemId: item.id })),
    });

    const items = [dependent, bug, cancelled, plan, archived];
    const readiness = computeReadiness(items, getRecordStatus);

    expect(readiness.get(dependent.id)).toMatchObject({
      state: 'ready',
      blockedBy: [],
      unresolvedBlockerIds: [],
    });
    expect(readiness.get(plan.id)?.state).toBe('closed');
    expect(readiness.get(archived.id)?.state).toBe('closed');
  });

  it('reports dangling ids without blocking and resolves personal dotted blocker refs', () => {
    const openBlocker = record(
      'open-blocker',
      'bug',
      { status: 'in-progress' },
      { localKey: 'NIM.75' },
    );
    const closedBlocker = record(
      'closed-blocker',
      'plan',
      { status: 'completed' },
      { localKey: 'NIM.76' },
    );
    const blocked = record(
      'blocked',
      'bug',
      { dependsOn: [{ itemId: openBlocker.id }, { itemId: closedBlocker.id }] },
      { localKey: 'NIM.77' },
    );
    const dangling = record(
      'dangling',
      'bug',
      { dependsOn: [{ itemId: 'deleted-item' }] },
      { localKey: 'NIM.78' },
    );

    const items = [blocked, dangling, openBlocker, closedBlocker];
    const readiness = computeReadiness(items, getRecordStatus);

    expect(readiness.get(blocked.id)).toMatchObject({
      state: 'blocked',
      blockedBy: [
        {
          itemId: openBlocker.id,
          ref: 'NIM.75',
          refStatus: 'local',
          status: 'in-progress',
          statusCategory: 'started',
        },
      ],
    });
    expect(readiness.get(dangling.id)).toMatchObject({
      state: 'ready',
      blockedBy: [],
      unresolvedBlockerIds: ['deleted-item'],
    });
    const anyRawIssueKey = [...readiness.values()].some((result) =>
      result.blockedBy.some((ref) => 'issueKey' in ref),
    );
    expect(anyRawIssueKey).toBe(false);
  });

  it('unions both directions, dedupes materialized inverses, and preserves stale inverse blocking', () => {
    const materializedBlocker = record('materialized-blocker', 'bug', {
      blocks: [{ itemId: 'materialized-dependent' }],
    });
    const materializedDependent = record('materialized-dependent', 'bug', {
      dependsOn: [{ itemId: materializedBlocker.id }],
    });
    const reverseOnlyBlocker = record('reverse-only-blocker', BLOCKS_ONLY_TYPE, {
      status: 'open',
      blocks: [{ itemId: 'reverse-only-dependent' }],
    });
    const reverseOnlyDependent = record('reverse-only-dependent', 'bug');
    const staleBlocker = record('stale-blocker', 'bug', {
      blocks: [{ itemId: 'stale-dependent' }],
    });
    const staleDependent = record('stale-dependent', 'bug', { dependsOn: [] });

    const items = [
      materializedDependent,
      materializedBlocker,
      reverseOnlyDependent,
      reverseOnlyBlocker,
      staleDependent,
      staleBlocker,
    ];
    const readiness = computeReadiness(items, getRecordStatus);
    const blockerIdsOf = (id: string) => readiness.get(id)?.blockedBy.map((ref) => ref.itemId);

    expect(readiness.get(materializedDependent.id)?.blockedBy).toHaveLength(1);
    expect(readiness.get(materializedBlocker.id)?.unblocks).toBe(1);
    expect(blockerIdsOf(reverseOnlyDependent.id)).toEqual([reverseOnlyBlocker.id]);
    // A stale materialized inverse remains authoritative until write propagation repairs it.
    expect(blockerIdsOf(staleDependent.id)).toEqual([staleBlocker.id]);
  });

  it('condenses a cycle once for diagnostics and track ids', () => {
    const a = record('a', 'bug', { dependsOn: [{ itemId: 'b' }] });
    const b = record('b', 'bug', { dependsOn: [{ itemId: 'a' }] });
    const afterCycle = record('c', 'bug', { dependsOn: [{ itemId: 'a' }] });
    const independent = record('d', 'bug');
    const items = [a, b, afterCycle, independent];

    const readiness = computeReadiness(items, getRecordStatus);

    expect(readiness.get('a')).toMatchObject({ state: 'blocked', inCycle: true, trackId: 'a' });
    expect(readiness.get('b')).toMatchObject({ state: 'blocked', inCycle: true, trackId: 'a' });
    expect(readiness.get('c')).toMatchObject({ state: 'blocked', inCycle: false, trackId: 'a' });
    expect(readiness.get('d')).toMatchObject({ state: 'ready', inCycle: false, trackId: 'd' });
  });

  it('reports a self-dependency as a cycle without crediting it as leverage', () => {
    // A field configured with allowSelfLink can store this; Tarjan alone
    // condenses it to a one-member SCC, which is not a cycle by size.
    const selfBlocked = record('self', 'bug', { dependsOn: [{ itemId: 'self' }] });
    const dependent = record('other', 'bug', { dependsOn: [{ itemId: 'self' }] });

    const readiness = computeReadiness([selfBlocked, dependent], getRecordStatus);

    expect(readiness.get('self')).toMatchObject({
      state: 'blocked',
      inCycle: true,
      unblocks: 1,
    });
    expect(readiness.get('other')).toMatchObject({ state: 'blocked', unblocks: 0 });
  });

  it('walks a dependency chain far deeper than the JS call stack', () => {
    // The recursive Tarjan this replaced threw RangeError at 10,000 links; the
    // chain is corpus-shaped, so nothing bounds it but what users can create.
    const DEPTH = 50_000;
    const id = (index: number) => `n${String(index).padStart(6, '0')}`;
    const items = Array.from({ length: DEPTH }, (_, index) =>
      record(
        id(index),
        'bug',
        index < DEPTH - 1 ? { dependsOn: [{ itemId: id(index + 1) }] } : {},
      ),
    );

    const readiness = computeReadiness(items, getRecordStatus);

    expect(readiness.get(id(0))).toMatchObject({
      state: 'blocked',
      inCycle: false,
      trackId: id(0),
    });
    // One weakly connected component: the union-find walk is as deep as Tarjan's.
    expect(readiness.get(id(DEPTH - 1))).toMatchObject({
      state: 'ready',
      unblocks: 1,
      trackId: id(0),
    });
  });
});
