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
export function referenceKeyForCandidate(candidate: { id: string; issueKey?: string }): string {
  return candidate.issueKey ?? candidate.id;
}

function toOption(candidate: TrackerReferenceCandidate): TrackerReferenceOption {
  return {
    referenceKey: referenceKeyForCandidate(candidate),
    id: candidate.id,
    issueKey: candidate.issueKey,
    title: candidate.title,
    status: candidate.status,
    type: candidate.type,
  };
}

/** True if a candidate is of (or tagged with) the given type, case-insensitively. */
function candidateMatchesType(candidate: TrackerReferenceCandidate, type: string): boolean {
  const t = type.toLowerCase();
  if (candidate.type?.toLowerCase() === t) return true;
  return (candidate.typeTags ?? []).some((tag) => tag.toLowerCase() === t);
}

/** Lower-cased primary types and type tags present on the candidates. */
export function collectCandidateTypes(
  candidates: Iterable<TrackerReferenceCandidate>,
  into: Set<string> = new Set(),
): Set<string> {
  for (const candidate of candidates) {
    if (candidate.type) into.add(candidate.type.toLowerCase());
    for (const tag of candidate.typeTags ?? []) into.add(tag.toLowerCase());
  }
  return into;
}

/**
 * Split a typed query into an optional type scope and the residual search text.
 * A leading `type:` prefix scopes the picker to that type when `type` is a known
 * tracker type (e.g. `bug:login` → filter to bugs matching "login"). Anything
 * else is treated as a plain search (issue keys contain `-`, never `:`).
 */
export function parseTypeScopedQuery(
  query: string | null,
  knownTypes: Set<string>,
): { typeFilter: string | null; searchQuery: string } {
  const raw = query ?? '';
  const colon = raw.indexOf(':');
  if (colon > 0) {
    const candidate = raw.slice(0, colon).toLowerCase();
    if (knownTypes.has(candidate)) {
      return { typeFilter: candidate, searchQuery: raw.slice(colon + 1) };
    }
  }
  return { typeFilter: null, searchQuery: raw };
}

/**
 * Rank candidates for the current query.
 *
 * Searches issue key, title, and description; excludes archived items, and
 * (when `typeFilter` is set) restricts to that tracker type. With no query,
 * returns the most-recent items (highest issue number first). With a query,
 * key-prefix matches sort ahead of substring matches.
 */
export function rankTrackerReferenceCandidates(
  candidates: Iterable<TrackerReferenceCandidate>,
  query: string | null,
  options: { typeFilter?: string | null; limit?: number } = {},
): TrackerReferenceOption[] {
  const { typeFilter = null, limit = 25 } = options;
  let active = [...candidates].filter((c) => !c.archived);
  if (typeFilter) {
    active = active.filter((c) => candidateMatchesType(c, typeFilter));
  }
  const q = query?.trim().toLowerCase() ?? '';

  if (!q) {
    return active
      .sort((a, b) => (b.issueNumber ?? 0) - (a.issueNumber ?? 0))
      .slice(0, limit)
      .map(toOption);
  }

  const scored: Array<{ candidate: TrackerReferenceCandidate; score: number }> = [];
  for (const candidate of active) {
    const key = referenceKeyForCandidate(candidate).toLowerCase();
    const issueKey = candidate.issueKey?.toLowerCase() ?? '';
    const title = (candidate.title ?? '').toLowerCase();
    const description = (candidate.description ?? '').toLowerCase();

    let score = -1;
    if (key.startsWith(q) || issueKey.startsWith(q)) score = 0;
    else if (key.includes(q) || issueKey.includes(q)) score = 1;
    else if (title.startsWith(q)) score = 2;
    else if (title.includes(q)) score = 3;
    else if (description.includes(q)) score = 4;

    if (score >= 0) scored.push({ candidate, score });
  }

  return scored
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      return (b.candidate.issueNumber ?? 0) - (a.candidate.issueNumber ?? 0);
    })
    .slice(0, limit)
    .map(({ candidate }) => toOption(candidate));
}

/** What a host's search returns for one typed `#…` query. */
export interface TrackerReferenceSearchResult {
  options: TrackerReferenceOption[];
  /** The `type:` scope the query carried, when it named a known type. */
  typeFilter: string | null;
  /** The query with any type scope removed. */
  searchQuery: string;
}

/** Parse a raw typed query and rank candidates against it. */
export function searchTrackerReferenceCandidates(
  candidates: readonly TrackerReferenceCandidate[],
  query: string | null,
  options: { knownTypes?: Set<string>; limit?: number } = {},
): TrackerReferenceSearchResult {
  const knownTypes = options.knownTypes ?? collectCandidateTypes(candidates);
  const { typeFilter, searchQuery } = parseTypeScopedQuery(query, knownTypes);
  return {
    options: rankTrackerReferenceCandidates(candidates, searchQuery, { typeFilter, limit: options.limit }),
    typeFilter,
    searchQuery,
  };
}
