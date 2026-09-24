import type { FieldDefinition, PredicateDefinition, TrackerDataModel } from '@nimbalyst/tracker-schema';

import type {
  TrackerDataChange,
  TrackerDataSnapshot,
  TrackerDataSource,
  TrackerItem,
  TrackerSyncState,
} from '../../../trackers/dataSource';
import type { TrackerReferenceSchema } from '../trackerReferenceResolver';

export function item(partial: Partial<TrackerItem> & Pick<TrackerItem, 'id' | 'type' | 'title'>): TrackerItem {
  return {
    status: 'asserted',
    module: '',
    workspace: 'ws',
    lastIndexed: new Date(0),
    ...partial,
  } as TrackerItem;
}

/**
 * A data source whose snapshot is held until `release()`, so a test can
 * observe the resolver before the first sync lands.
 */
export function fakeDataSource(
  status: TrackerSyncState['status'] = 'connected',
  options: { rejectFirstSnapshot?: boolean } = {},
) {
  const listeners = new Set<(change: TrackerDataChange) => void>();
  let items: TrackerItem[] = [];
  let sync: TrackerSyncState = { workspacePath: 'ws', status, projectId: 'p' };
  let release!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  let snapshotCalls = 0;
  const source = {
    snapshot: async (): Promise<TrackerDataSnapshot> => {
      snapshotCalls += 1;
      await released;
      if (options.rejectFirstSnapshot && snapshotCalls === 1) throw new Error('snapshot failed');
      return { items, savedViews: [], presence: [], sync };
    },
    subscribe: (cb: (change: TrackerDataChange) => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    command: async () => ({ ok: true }),
    status: () => sync,
    getItemRevision: async () => { throw new Error('unsupported'); },
    dispose: () => {},
  } as unknown as TrackerDataSource;
  return {
    source,
    get snapshotCalls() { return snapshotCalls; },
    async release(initial: TrackerItem[]) {
      items = initial;
      release();
      await Promise.resolve();
      await Promise.resolve();
    },
    emit(change: TrackerDataChange) {
      if (change.type === 'status') sync = change.sync;
      if (change.type === 'items-replaced') items = change.items;
      for (const listener of listeners) listener(change);
    },
  };
}

const rel = (name: string, relationshipTypeKey: string, multiValue = false): FieldDefinition =>
  ({ name, type: 'relationship', relationshipTypeKey, multiValue }) as FieldDefinition;

const models: Record<string, TrackerDataModel> = {
  entity: {
    type: 'entity', displayName: 'Entity', color: '#3b82f6', icon: 'category',
    fields: [
      { name: 'status', type: 'select', options: [{ value: 'active', label: 'Active', category: 'started' }] },
      { name: 'kind', type: 'select', options: [{ value: 'service', label: 'Service' }] },
    ],
  } as unknown as TrackerDataModel,
  claim: {
    type: 'claim', displayName: 'Claim', color: '#f59e0b', icon: 'forum',
    fields: [
      { name: 'status', type: 'select', options: [{ value: 'asserted', label: 'Asserted', category: 'started' }] },
      rel('subject', 'about'),
      rel('object', 'states'),
      { name: 'basis', type: 'select', options: [{ value: 'observed', label: 'Observed' }] },
    ],
  } as unknown as TrackerDataModel,
  question: {
    type: 'question', displayName: 'Question', color: '#8b5cf6', icon: 'help',
    fields: [
      {
        name: 'status', type: 'select', options: [
          { value: 'open', label: 'Open', category: 'unstarted' },
          { value: 'investigating', label: 'Investigating', category: 'started' },
          { value: 'answered', label: 'Answered', category: 'done' },
          { value: 'deferred', label: 'Deferred', category: 'backlog' },
          { value: 'abandoned', label: 'Abandoned', category: 'cancelled' },
        ],
      },
      rel('subjects', 'concerns', true),
      rel('answers', 'answered-by', true),
    ],
  } as unknown as TrackerDataModel,
  'wiki-decision': {
    type: 'wiki-decision', displayName: 'Decision', color: '#f59e0b', icon: 'gavel',
    fields: [
      {
        name: 'status', type: 'select', options: [
          { value: 'proposed', label: 'Proposed', category: 'unstarted' },
          { value: 'accepted', label: 'Accepted', category: 'done' },
          { value: 'rejected', label: 'Rejected', category: 'cancelled' },
          { value: 'superseded', label: 'Superseded', category: 'cancelled' },
        ],
      },
    ],
  } as unknown as TrackerDataModel,
};

const predicates: Record<string, PredicateDefinition> = {
  'depends-on-service': { id: 'depends-on-service', label: 'Depends on', subjectKinds: ['*'], valueShape: 'entity', direction: 'directed' },
  'rate-limit': { id: 'rate-limit', label: 'Rate limit', subjectKinds: ['*'], valueShape: 'text', direction: 'directed' } as PredicateDefinition,
};

export function fakeSchema(): TrackerReferenceSchema {
  return {
    get: (type) => models[type],
    getPredicate: (id) => predicates[id],
    onChange: () => () => {},
  };
}
