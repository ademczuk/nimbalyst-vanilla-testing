/**
 * Match-and-rank for a quick-open palette over a mixed corpus.
 *
 * The corpus is documents and tracker items together, which is the whole
 * difficulty: they have nothing in common except a title and a timestamp, and
 * ranking them against each other by "whatever each surface already sorts by"
 * gives an order that changes meaning depending on which kind happens to be
 * loaded. So both are projected onto one `QuickOpenEntry` and scored by *where*
 * the query matched, not by which kind matched.
 *
 * Pure and host-free on purpose. Nothing about the ranking is visible on
 * screen -- a reader cannot tell a correct order from a plausible one -- so
 * this is the part that has to be tested rather than looked at.
 */
export type QuickOpenEntryKind = 'document' | 'tracker';
export interface QuickOpenEntry {
    kind: QuickOpenEntryKind;
    /** Stable within a kind; the palette keys rows on `${kind}:${id}`. */
    id: string;
    title: string;
    /** Folder path for a document, tracker type for an item. Searched after the title. */
    subtitle?: string | null;
    /** Issue key, or any other citable identifier. Key-matched as well as searched. */
    key?: string | null;
    /** Free text searched last -- a description or summary. */
    detail?: string | null;
    /** Epoch milliseconds. Orders an empty query, and breaks score ties. */
    updatedAt?: number | null;
    /** Material Symbols ligature name the palette draws for this row. */
    icon?: string;
}
export interface RankQuickOpenOptions {
    /** How many entries to return. The palette cannot show more than a screenful. */
    limit?: number;
}
/**
 * The ranked corpus for `query`.
 *
 * An issue-key-shaped query pins its exact matches to the top ahead of the text
 * ranking, because "2374" ranks by meaning otherwise and never resolves to the
 * item the reader is naming. That is the same rule the desktop's Trackers pane
 * applies; it is stated once, here, rather than in each palette.
 */
export declare function rankQuickOpenEntries<T extends QuickOpenEntry>(entries: readonly T[], query: string, options?: RankQuickOpenOptions): T[];
/**
 * The score ladder, exported so a test can name a tier instead of a number.
 * An exact issue-key hit has no entry here because it is not scored -- it is
 * pinned above the ranking.
 */
export declare const QUICK_OPEN_SCORES: {
    readonly titleExact: 80;
    readonly titlePrefix: 70;
    readonly titleWord: 60;
    readonly titleSubstring: 50;
    readonly key: 40;
    readonly subtitle: 30;
    readonly detail: 20;
};
