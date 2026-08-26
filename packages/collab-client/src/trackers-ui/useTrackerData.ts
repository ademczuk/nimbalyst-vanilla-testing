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

import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { TrackerDataCommand, TrackerDataCommandResult } from '@nimbalyst/collab-client/trackers';
import { useTrackerDataStoreOrThrow } from './TrackersUIProvider';
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
export function useTrackerDataSelector<Selection>(
  selector: (state: TrackerDataState) => Selection,
  isEqual: (left: Selection, right: Selection) => boolean = Object.is,
): Selection {
  const store = useTrackerDataStoreOrThrow();
  const selectorRef = useRef(selector);
  const isEqualRef = useRef(isEqual);
  const cacheRef = useRef<{
    store: typeof store;
    selector: typeof selector;
    snapshot: TrackerDataState;
    selection: Selection;
  } | null>(null);
  selectorRef.current = selector;
  isEqualRef.current = isEqual;

  const getSelection = useCallback(() => {
    const snapshot = store.getSnapshot();
    const currentSelector = selectorRef.current;
    const cached = cacheRef.current;
    if (
      cached?.store === store
      && cached.selector === currentSelector
      && cached.snapshot === snapshot
    ) return cached.selection;
    const selection = currentSelector(snapshot);
    if (
      cached?.store === store
      && cached.selector === currentSelector
      && isEqualRef.current(cached.selection, selection)
    ) {
      cacheRef.current = { store, selector: currentSelector, snapshot, selection: cached.selection };
      return cached.selection;
    }
    cacheRef.current = { store, selector: currentSelector, snapshot, selection };
    return selection;
  }, [store]);

  return useSyncExternalStore(store.subscribe, getSelection, getSelection);
}

/** Backward-compatible full-state reader. Production surfaces select narrowly. */
export function useTrackerData(): TrackerDataState {
  return useTrackerDataSelector(state => state);
}

/** Commands are stable for the lifetime of the provider-owned room store. */
export function useTrackerCommand(): (
  command: TrackerDataCommand,
) => Promise<TrackerDataCommandResult> {
  return useTrackerDataStoreOrThrow().command;
}
