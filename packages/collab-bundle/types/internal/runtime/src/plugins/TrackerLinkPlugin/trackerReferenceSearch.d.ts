/**
 * Search and ranking behind the `#` tracker-reference typeahead.
 *
 * Pure and free of Lexical, React and the tracker stores so that every host
 * ranks the same way: desktop feeds it `TrackerRecord`s from the runtime store,
 * the browser resolver feeds it the `TrackerItem`s of a tracker room. Each host
 * maps its own item shape to a {@link TrackerReferenceCandidate} first.
 */
/** The fields ranking reads, whatever store the item came from. */
export interface TrackerReferenceCandidate {
    id: string;
    issueKey?: string;
    issueNumber?: number;
    title: string;
    description?: string;
    status?: string;
    /** Primary tracker type (bug/task/plan/...). */
    type: string;
    typeTags?: readonly string[];
    archived?: boolean;
}
/** A single resolved candidate for the `#` reference menu. */
export interface TrackerReferenceOption {
    /** The reference key inserted into the document (issueKey, else record id). */
    referenceKey: string;
    /** Internal record id (stable React key / de-dup). */
    id: string;
    /** Human-readable issue key (NIM-123) when the item is synced. */
    issueKey?: string;
    title: string;
    /** Raw status string (e.g. 'in-progress'). */
    status?: string;
    /** Primary tracker type (bug/task/plan/...). */
    type: string;
}
/**
 * The reference key to embed: prefer the human issue key (NIM-123), else the
 * raw id. The raw id (not a `tk_…` short id) because reference resolution looks
 * keys up by id, so the raw id is guaranteed to resolve.
 */
export declare function referenceKeyForCandidate(candidate: {
    id: string;
    issueKey?: string;
}): string;
/** Lower-cased primary types and type tags present on the candidates. */
export declare function collectCandidateTypes(candidates: Iterable<TrackerReferenceCandidate>, into?: Set<string>): Set<string>;
/**
 * Split a typed query into an optional type scope and the residual search text.
 * A leading `type:` prefix scopes the picker to that type when `type` is a known
 * tracker type (e.g. `bug:login` → filter to bugs matching "login"). Anything
 * else is treated as a plain search (issue keys contain `-`, never `:`).
 */
export declare function parseTypeScopedQuery(query: string | null, knownTypes: Set<string>): {
    typeFilter: string | null;
    searchQuery: string;
};
/**
 * Rank candidates for the current query.
 *
 * Searches issue key, title, and description; excludes archived items, and
 * (when `typeFilter` is set) restricts to that tracker type. With no query,
 * returns the most-recent items (highest issue number first). With a query,
 * key-prefix matches sort ahead of substring matches.
 */
export declare function rankTrackerReferenceCandidates(candidates: Iterable<TrackerReferenceCandidate>, query: string | null, options?: {
    typeFilter?: string | null;
    limit?: number;
}): TrackerReferenceOption[];
/** What a host's search returns for one typed `#…` query. */
export interface TrackerReferenceSearchResult {
    options: TrackerReferenceOption[];
    /** The `type:` scope the query carried, when it named a known type. */
    typeFilter: string | null;
    /** The query with any type scope removed. */
    searchQuery: string;
}
/** Parse a raw typed query and rank candidates against it. */
export declare function searchTrackerReferenceCandidates(candidates: readonly TrackerReferenceCandidate[], query: string | null, options?: {
    knownTypes?: Set<string>;
    limit?: number;
}): TrackerReferenceSearchResult;
