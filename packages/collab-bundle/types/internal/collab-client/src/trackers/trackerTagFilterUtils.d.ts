import type { TrackerRecord } from '../../../runtime/src/core/TrackerRecord';
export interface TrackerTagOption {
    name: string;
    count: number;
}
export declare function normalizeTrackerTagList(value: unknown): string[];
export declare function getTrackerItemTags(item: TrackerRecord): string[];
export declare function buildTrackerTagOptions(items: TrackerRecord[]): TrackerTagOption[];
export declare function filterTrackerItemsByTags(items: TrackerRecord[], activeTags: string[]): TrackerRecord[];
/**
 * A single column of the tag board (NIM-774). `tag` is the tag name the column
 * represents, or `null` for the trailing "Untagged" bucket.
 */
export interface TrackerTagBoardColumn {
    tag: string | null;
    label: string;
    items: TrackerRecord[];
}
/**
 * Group items into tag-board columns. Each distinct tag (from the schema `tags`
 * role / array field) becomes a column; an item carrying multiple tags appears
 * in every matching column. Columns are ordered by item count (desc) then tag
 * name (asc) to keep the busiest tags first and the order stable. Items with no
 * tags collect into a trailing "Untagged" column, which is omitted entirely when
 * every item is tagged.
 */
export declare function groupTrackerItemsByTag(items: TrackerRecord[]): TrackerTagBoardColumn[];
