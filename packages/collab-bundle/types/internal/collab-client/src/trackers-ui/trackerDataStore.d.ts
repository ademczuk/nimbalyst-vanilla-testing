import { type TrackerRecord } from '../../../runtime/src/core/TrackerRecord';
import { type SavedView, type TrackerDataCommand, type TrackerDataCommandResult, type TrackerDataSource, type TrackerMutationRejection, type TrackerPresenceMember, type TrackerSyncState } from '../trackers/index';
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
/**
 * One room-scoped external store shared by every tracker surface below a
 * provider. The data source subscription and initial projection reads happen
 * here, never in consumer hooks.
 */
export declare function createTrackerDataStore(dataSource: TrackerDataSource): TrackerDataStore;
