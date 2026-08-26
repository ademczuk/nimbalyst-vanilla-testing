import { trackerItemToRecord, type TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import {
  parseSharedSavedView,
  withBuiltInSavedViews,
  type SavedView,
  type TrackerDataChange,
  type TrackerDataCommand,
  type TrackerDataCommandResult,
  type TrackerDataSnapshot,
  type TrackerDataSource,
  type TrackerMutationRejection,
  type TrackerPresenceMember,
  type TrackerSyncState,
} from '@nimbalyst/collab-client/trackers';

export interface TrackerDataState {
  records: TrackerRecord[];
  recordsById: ReadonlyMap<string, TrackerRecord>;
  /** Shared views from the room, plus the built-ins this build ships. */
  savedViews: SavedView[];
  presence: TrackerPresenceMember[];
  sync: TrackerSyncState;
  /** The most recent server rejection, for the surface to say out loud. */
  rejection: TrackerMutationRejection | null;
  /** False until the first snapshot resolves; distinguishes "empty" from "not yet". */
  loaded: boolean;
}

export interface TrackerDataStore {
  getSnapshot: () => TrackerDataState;
  subscribe: (listener: () => void) => () => void;
  command: (command: TrackerDataCommand) => Promise<TrackerDataCommandResult>;
  start: () => void;
  stop: () => void;
}

function projectItems(items: TrackerDataSnapshot['items']): Pick<TrackerDataState, 'records' | 'recordsById'> {
  const recordsById = new Map<string, TrackerRecord>();
  for (const item of items) recordsById.set(item.id, trackerItemToRecord(item));
  return { recordsById, records: [...recordsById.values()] };
}

function projectSavedViews(snapshot: TrackerDataSnapshot['savedViews']): SavedView[] {
  return withBuiltInSavedViews(
    snapshot.map(parseSharedSavedView).filter((view): view is SavedView => view !== null),
  );
}

function reduceChange(previous: TrackerDataState, change: TrackerDataChange): TrackerDataState {
  switch (change.type) {
    case 'items-replaced':
      return { ...previous, ...projectItems(change.items) };
    case 'items-upserted': {
      const recordsById = new Map(previous.recordsById);
      for (const item of change.items) recordsById.set(item.id, trackerItemToRecord(item));
      return { ...previous, recordsById, records: [...recordsById.values()] };
    }
    case 'items-removed': {
      const recordsById = new Map(previous.recordsById);
      for (const id of change.itemIds) recordsById.delete(id);
      return { ...previous, recordsById, records: [...recordsById.values()] };
    }
    case 'saved-views-replaced':
      return { ...previous, savedViews: projectSavedViews(change.savedViews) };
    case 'presence':
      return { ...previous, presence: change.members };
    case 'status':
      return { ...previous, sync: change.sync };
    case 'mutation-rejected':
      return { ...previous, rejection: change.rejection };
    default:
      return previous;
  }
}

/**
 * One room-scoped external store shared by every tracker surface below a
 * provider. The data source subscription and initial projection reads happen
 * here, never in consumer hooks.
 */
export function createTrackerDataStore(dataSource: TrackerDataSource): TrackerDataStore {
  let state: TrackerDataState = {
    ...projectItems([]),
    savedViews: withBuiltInSavedViews([]),
    presence: [],
    sync: dataSource.status(),
    rejection: null,
    loaded: false,
  };
  const listeners = new Set<() => void>();
  let unsubscribeDataSource: (() => void) | null = null;
  let snapshotStarted = false;
  let active = false;
  let changesDuringSnapshot: TrackerDataChange[] | null = null;

  const publish = (next: TrackerDataState) => {
    if (next === state) return;
    state = next;
    for (const listener of listeners) listener();
  };

  const start = () => {
    if (active) return;
    active = true;
    unsubscribeDataSource = dataSource.subscribe((change) => {
      if (!active) return;
      changesDuringSnapshot?.push(change);
      publish(reduceChange(state, change));
    });

    if (snapshotStarted) return;
    snapshotStarted = true;
    changesDuringSnapshot = [];
    void dataSource.snapshot().then((snapshot) => {
      if (!active) return;
      let next: TrackerDataState = {
        ...projectItems(snapshot.items),
        savedViews: projectSavedViews(snapshot.savedViews),
        presence: snapshot.presence,
        sync: snapshot.sync,
        // A fast rejection may arrive after subscribe but before the snapshot.
        rejection: state.rejection,
        loaded: true,
      };
      for (const change of changesDuringSnapshot ?? []) next = reduceChange(next, change);
      changesDuringSnapshot = null;
      publish(next);
    });
  };

  const stop = () => {
    active = false;
    unsubscribeDataSource?.();
    unsubscribeDataSource = null;
  };

  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    command: command => dataSource.command(command),
    start,
    stop,
  };
}
