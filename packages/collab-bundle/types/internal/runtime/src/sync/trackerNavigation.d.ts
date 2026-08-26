export type TrackerNavigationEntry = TrackerNavigationFolder | TrackerTypePlacement;
/** Whose a folder is. Mirrors a tracker's `sharing`, which is its own owner. */
export type TrackerNavigationOwnership = 'personal' | 'team';
export interface TrackerNavigationFolder {
    entryId: `folder:${string}`;
    kind: 'folder';
    folderId: string;
    name: string;
    sortKey: string;
    /**
     * A personal folder never leaves the machine; a team folder syncs. Rows
     * written before this field existed carry no value on the wire — the store
     * coerces them on read (a row that ever synced is the team's), so every entry
     * a caller sees has one.
     */
    ownership: TrackerNavigationOwnership;
}
export interface TrackerTypePlacement {
    entryId: `type:${string}`;
    kind: 'type-placement';
    trackerType: string;
    folderId: string | null;
    sortKey: string;
}
export declare function isTrackerNavigationEntry(value: unknown): value is TrackerNavigationEntry;
export declare function compareTrackerNavigationEntries(a: TrackerNavigationEntry, b: TrackerNavigationEntry): number;
