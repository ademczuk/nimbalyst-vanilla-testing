/**
 * Recognising a tracker item by its issue key.
 *
 * Lifted out of the desktop's `UnifiedQuickOpen/issueKeyLookup.ts` so the
 * browser console's palette resolves "NIM-2374" the same way the desktop does.
 * The desktop half that shapes a match into a semantic-search result stayed
 * behind: it depends on the search engine's record type, which is a
 * main-process concern and has no business in a shared client package.
 *
 * Everything here is structural rather than typed against `TrackerItem`. The
 * two hosts hold different record shapes -- the desktop's `TrackerItem` and the
 * room's `TrackerRecord` -- and only these four fields are common to both.
 */

export interface ParsedIssueKeyQuery {
  /** Key prefix the user typed (e.g. "NIM"), or null when they typed only a number. */
  prefix: string | null;
  /** Issue number, leading zeros stripped. */
  number: string;
}

/** Accepts "NIM-2374", "nim 2374", "nim2374", "#2374" and a bare "2374". */
const ISSUE_KEY_QUERY = /^#?\s*([a-z]+)?[\s-]*(\d{1,9})$/i;

/** Issue keys are always `<letters>-<digits>`. */
const ISSUE_KEY = /^([a-z]+)-(\d+)$/i;

/** The fields both hosts' record shapes agree on. */
export interface IssueKeyCandidate {
  id: string;
  issueKey?: string | null;
  archived?: boolean;
  /** ISO timestamp; used only to order several matches. */
  updated?: string | null;
}

export function parseIssueKeyQuery(query: string): ParsedIssueKeyQuery | null {
  const match = ISSUE_KEY_QUERY.exec(query.trim());
  if (!match) return null;
  return {
    prefix: match[1] ? match[1].toLowerCase() : null,
    number: match[2]!.replace(/^0+(?=\d)/, ''),
  };
}

export function matchesIssueKey(issueKey: string, parsed: ParsedIssueKeyQuery): boolean {
  const match = ISSUE_KEY.exec(issueKey);
  if (!match) return false;
  if (parsed.prefix && match[1]!.toLowerCase() !== parsed.prefix) return false;
  return match[2] === parsed.number;
}

/**
 * Exact issue-key matches for `query`, newest first. A bare number matches any
 * prefix, so a workspace with more than one key prefix can still return several.
 */
export function findTrackersByIssueKey<T extends IssueKeyCandidate>(
  query: string,
  items: readonly T[],
): T[] {
  const parsed = parseIssueKeyQuery(query);
  if (!parsed) return [];
  return items
    .filter(
      (item) => !item.archived && !!item.issueKey && matchesIssueKey(item.issueKey, parsed),
    )
    .sort((a, b) => {
      const ta = a.updated ? Date.parse(a.updated) : 0;
      const tb = b.updated ? Date.parse(b.updated) : 0;
      return tb - ta;
    });
}

/** The text fields a tracker pane searches. */
export interface TrackerTextCandidate {
  id?: string | null;
  title?: string | null;
  issueKey?: string | null;
  description?: string | null;
}

/**
 * Substring match across those fields. `query` must already be lowercased.
 * Every field is optional-chained: a frontmatter item with no heading has a
 * null title, and an unguarded `.toLowerCase()` on it threw straight into the
 * desktop dialog's error boundary.
 */
export function matchesTrackerText(item: TrackerTextCandidate, query: string): boolean {
  return (
    !!item.title?.toLowerCase().includes(query) ||
    !!item.issueKey?.toLowerCase().includes(query) ||
    !!item.description?.toLowerCase().includes(query) ||
    !!item.id?.toLowerCase().includes(query)
  );
}
