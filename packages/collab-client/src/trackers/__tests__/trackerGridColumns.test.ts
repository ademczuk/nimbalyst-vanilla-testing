// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import { resolveColumnsForType } from '@nimbalyst/runtime/plugins/TrackerPlugin/components/trackerColumns';
import { globalRegistry, type TrackerDataModel } from '@nimbalyst/runtime/plugins/TrackerPlugin/models/TrackerDataModel';
import { buildGridSource, ROW_ITEM_ID, ROW_ITEM_TYPE } from '../trackerGridColumns';

const gridType = 'headlessGridColumnSpec';

function registerType(): void {
  const model: TrackerDataModel = {
    type: gridType,
    displayName: 'Spec',
    displayNamePlural: 'Specs',
    icon: 'assignment',
    color: '#000000',
    modes: { inline: true, fullDocument: false },
    idPrefix: 'gcs',
    idFormat: 'ulid',
    fields: [
      { name: 'title', type: 'string', required: true },
      { name: 'points', type: 'number' },
    ],
    roles: { title: 'title' },
  };
  globalRegistry.register(model);
}

function record(fields: Record<string, unknown>): TrackerRecord {
  return {
    id: '1',
    primaryType: gridType,
    typeTags: [gridType],
    issueKey: 'GCS-1',
    source: 'native',
    archived: false,
    syncStatus: 'local',
    system: {
      workspace: '/w',
      createdAt: '2026-07-23T00:00:00.000Z',
      updatedAt: '2026-07-23T00:00:00.000Z',
      authorIdentity: {
        email: 'alice@example.com',
        displayName: 'Alice Example',
        gitName: null,
        gitEmail: null,
      },
    },
    fields,
  } as TrackerRecord;
}

describe('buildGridSource', () => {
  afterEach(() => globalRegistry.unregister(gridType));

  it('derives raw schema and structural values without display coercion', () => {
    registerType();
    const columns = resolveColumnsForType(gridType)
      .filter(column => ['key', 'title', 'points', 'createdBy'].includes(column.id));
    const [source] = buildGridSource([record({ title: 'Alpha', points: 8 })], columns);

    expect(source).toMatchObject({
      [ROW_ITEM_ID]: '1',
      [ROW_ITEM_TYPE]: gridType,
      key: 'GCS-1',
      title: 'Alpha',
      points: 8,
      createdBy: { email: 'alice@example.com', displayName: 'Alice Example' },
    });
  });
});
