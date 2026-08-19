/**
 * @vitest-environment node
 *
 * Bulk milestone assignment: what it writes, and what it costs.
 *
 * Both halves are invisible on screen. Assigning a selection has to write the
 * `in-collection` relationship for every card while leaving each card's release
 * membership alone -- a scalar write or a clobbered value corrupts rows silently
 * -- and it has to reach main in one round trip rather than one per card.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import {
  loadBuiltinTrackers,
  normalizeRelationshipValue,
  type TrackerRelationshipValue,
} from '@nimbalyst/runtime/plugins/TrackerPlugin/models';
import { resolveMilestoneAssignmentWrites } from '../trackerBulkAssign';
import { saveTrackerFieldsBatch } from '../trackerFieldSave';

beforeAll(() => {
  loadBuiltinTrackers();
});

function record(
  id: string,
  primaryType: string,
  fields: Record<string, unknown> = {},
  overrides: Partial<TrackerRecord> = {},
): TrackerRecord {
  return {
    id,
    primaryType,
    typeTags: [primaryType],
    issueKey: `NIM-${id}`,
    source: 'native',
    archived: false,
    syncStatus: 'local',
    system: {
      workspace: '/w',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    },
    fields: { title: `Item ${id}`, status: 'draft', ...fields },
    ...overrides,
  } as unknown as TrackerRecord;
}

const RELEASE_REF: TrackerRelationshipValue = {
  itemId: 'rel_1',
  title: 'v1.0',
  trackerType: 'release',
  direction: 'out',
  relationshipTypeKey: 'in-collection',
};

function milestoneRef(itemId: string, title: string): TrackerRelationshipValue {
  return {
    itemId,
    title,
    trackerType: 'milestone',
    direction: 'out',
    relationshipTypeKey: 'in-collection',
  };
}

const BETA = { itemId: 'mst_beta', title: 'Teams beta', issueKey: 'NIM-900' };

describe('bulk milestone assignment', () => {
  it('writes the relationship for every card and preserves each release membership', () => {
    // Half the plans already ride a release; that membership is off this axis and
    // must survive the assignment.
    const plans = Array.from({ length: 50 }, (_, index) =>
      record(`p${index}`, 'plan', index % 2 === 0 ? { collection: [RELEASE_REF] } : {}));

    const writes = resolveMilestoneAssignmentWrites(plans, BETA);

    expect(writes).toHaveLength(50);
    for (const [index, write] of writes.entries()) {
      const values = normalizeRelationshipValue(write.updates.collection);
      expect(values.map(value => value.itemId)).toEqual(
        index % 2 === 0 ? ['rel_1', 'mst_beta'] : ['mst_beta'],
      );
      expect(values.find(value => value.itemId === 'mst_beta')).toMatchObject({
        trackerType: 'milestone',
        relationshipTypeKey: 'in-collection',
        issueKey: 'NIM-900',
        title: 'Teams beta',
      });
      // Relationship values live under the field, never as a bare scalar.
      expect(Array.isArray(write.updates.collection)).toBe(true);
    }
  });

  it('reassigns off a different milestone rather than adding a second one', () => {
    const [write] = resolveMilestoneAssignmentWrites(
      [record('p1', 'plan', { collection: [milestoneRef('mst_alpha', 'Alpha'), RELEASE_REF] })],
      BETA,
    );
    expect(normalizeRelationshipValue(write.updates.collection).map(v => v.itemId))
      .toEqual(['rel_1', 'mst_beta']);
  });

  it('skips cards already in the target and cards whose type has no milestone field', () => {
    const items = [
      record('placed', 'plan', { collection: [milestoneRef('mst_beta', 'Teams beta')] }),
      record('unplaced', 'plan'),
      record('milestone-itself', 'milestone'),
    ];

    expect(resolveMilestoneAssignmentWrites(items, BETA).map(write => write.item.id))
      .toEqual(['unplaced']);
  });

  it('clears the milestone without touching the release when the target is empty', () => {
    const items = [
      record('p1', 'plan', { collection: [milestoneRef('mst_beta', 'Teams beta'), RELEASE_REF] }),
      record('p2', 'plan'),
    ];

    const writes = resolveMilestoneAssignmentWrites(items, { itemId: null });

    // p2 is already unplaced, so clearing it would be a write nobody could see.
    expect(writes.map(write => write.item.id)).toEqual(['p1']);
    expect(normalizeRelationshipValue(writes[0].updates.collection).map(v => v.itemId))
      .toEqual(['rel_1']);
  });
});

describe('batched writes', () => {
  interface BatchResult {
    success: boolean;
    results: Array<{ itemId: string; success: boolean; error?: string }>;
  }
  const updateTrackerItems = vi.fn(
    async (payload: { entries: Array<{ itemId: string }> }): Promise<BatchResult> => ({
      success: true,
      results: payload.entries.map(entry => ({ itemId: entry.itemId, success: true })),
    }),
  );
  const updateTrackerItem = vi.fn(async () => ({ success: true }));
  const updateTrackerItemInFile = vi.fn(async () => ({ success: true }));
  const invoke = vi.fn(async () => ({ success: true }));

  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as unknown as { window: unknown }).window = {
      electronAPI: {
        invoke,
        documentService: { updateTrackerItems, updateTrackerItem, updateTrackerItemInFile },
      },
    };
  });

  it('sends one update call and one reindex call for a fifty-card assignment', async () => {
    // Frontmatter-backed plans, which is what the unplaced pile actually is.
    const plans = Array.from({ length: 50 }, (_, index) =>
      record(`p${index}`, 'plan', {}, {
        source: 'frontmatter',
        system: {
          workspace: '/w',
          documentPath: `plans/p${index}.md`,
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T00:00:00.000Z',
        },
      } as Partial<TrackerRecord>));

    const result = await saveTrackerFieldsBatch(resolveMilestoneAssignmentWrites(plans, BETA));

    expect(result).toEqual({ written: 50, failed: 0 });
    expect(updateTrackerItems).toHaveBeenCalledTimes(1);
    expect(updateTrackerItem).not.toHaveBeenCalled();
    expect(updateTrackerItemInFile).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledTimes(1);

    const { entries } = updateTrackerItems.mock.calls[0][0] as {
      entries: Array<{ itemId: string; fileUpdates?: Record<string, unknown>; storeUpdates?: unknown }>;
    };
    expect(entries).toHaveLength(50);
    // A frontmatter-backed item's fields belong to its file, not the store.
    expect(entries[0].fileUpdates).toHaveProperty('collection');
    expect(entries[0].storeUpdates).toBeUndefined();
  });

  it('routes a native item to the store and keeps board sort order out of the file', async () => {
    const entries = [
      { item: record('native', 'bug'), updates: { status: 'done' } },
      {
        item: record('filed', 'plan', {}, {
          source: 'frontmatter',
          system: {
            workspace: '/w',
            documentPath: 'plans/filed.md',
            createdAt: '2026-08-01T00:00:00.000Z',
            updatedAt: '2026-08-01T00:00:00.000Z',
          },
        } as Partial<TrackerRecord>),
        updates: { status: 'in-development', kanbanSortOrder: 'a1' },
      },
    ];

    await saveTrackerFieldsBatch(entries);

    const sent = (updateTrackerItems.mock.calls[0][0] as {
      entries: Array<{ itemId: string; fileUpdates?: unknown; storeUpdates?: unknown }>;
    }).entries;
    expect(sent[0]).toMatchObject({ itemId: 'native', storeUpdates: { status: 'done' } });
    expect(sent[0].fileUpdates).toBeUndefined();
    expect(sent[1]).toMatchObject({
      itemId: 'filed',
      fileUpdates: { status: 'in-development' },
      storeUpdates: { kanbanSortOrder: 'a1' },
    });
  });

  it('reports failures per item instead of claiming the batch succeeded', async () => {
    updateTrackerItems.mockResolvedValueOnce({
      success: false,
      results: [
        { itemId: 'a', success: true },
        { itemId: 'b', success: false, error: 'nope' },
      ],
    });

    const result = await saveTrackerFieldsBatch([
      { item: record('a', 'bug'), updates: { status: 'done' } },
      { item: record('b', 'bug'), updates: { status: 'done' } },
    ]);

    expect(result).toEqual({ written: 1, failed: 1 });
  });
});
