/**
 * The one subscription every tracker surface reads from.
 *
 * `TrackerDataSource` is a projection/command seam, not a store: it hands out a
 * snapshot and then a stream of changes. Turning that into React state exactly
 * once -- here -- is what keeps the grid, the board, the list, and the detail
 * panel from disagreeing about what the room contains, and what keeps a host
 * from needing four subscriptions to render one screen.
 *
 * The state is deliberately record-shaped rather than item-shaped. Every shared
 * selector (`filterTrackerItems`, `buildTrackerBoardColumns`, `buildGridSource`)
 * speaks `TrackerRecord`, so the conversion happens at the boundary and nowhere
 * else.
 */
import type { TrackerDataCommand, TrackerDataCommandResult } from '../trackers/index';
import type { TrackerDataState } from './trackerDataStore';
export type { TrackerDataState } from './trackerDataStore';
/**
 * Subscribe to one stable selection from the provider-owned tracker store.
 *
 * The per-hook cache is load-bearing: React may call `getSnapshot` repeatedly
 * without a store update, and a selector that assembles an object must still
 * return the same reference for that snapshot or React treats it as a change
 * loop. Consumers should still select the narrowest stable field they need.
 */
export declare function useTrackerDataSelector<Selection>(selector: (state: TrackerDataState) => Selection, isEqual?: (left: Selection, right: Selection) => boolean): Selection;
/** Backward-compatible full-state reader. Production surfaces select narrowly. */
export declare function useTrackerData(): TrackerDataState;
/** Commands are stable for the lifetime of the provider-owned room store. */
export declare function useTrackerCommand(): (command: TrackerDataCommand) => Promise<TrackerDataCommandResult>;
