import type { TrackerRecord } from '../../core/TrackerRecord';

export type GithubUrlKind = 'pull' | 'issues';
type GithubSystemLinkKey = 'linkedPullRequests' | 'linkedIssues';

export interface GithubReference {
  /** GitHub remote as "owner/repo" (lowercase). */
  remote: string;
  number: number;
}

const GITHUB_ITEM_URL_RE = /(?:^|\/\/)(?:www\.)?github\.com\/([^/\s]+)\/([^/\s]+)\/(pull|issues)\/(\d+)(?:[/?#]|$)/i;

/** Parse a GitHub PR or issue URL into a reference. */
export function parseGithubUrl(url: string, kind: GithubUrlKind): GithubReference | null {
  if (typeof url !== 'string' || !url) return null;
  const match = GITHUB_ITEM_URL_RE.exec(url);
  if (!match || match[3].toLowerCase() !== kind) return null;
  const number = Number(match[4]);
  if (!Number.isSafeInteger(number) || number <= 0) return null;
  return { remote: `${match[1]}/${match[2]}`.toLowerCase(), number };
}

/** Build the canonical GitHub URL for a PR or issue reference. */
export function buildGithubUrl(remote: string, kind: GithubUrlKind, number: number): string {
  return `https://github.com/${remote}/${kind}/${number}`;
}

function pushUnique(refs: GithubReference[], ref: GithubReference): void {
  if (!refs.some((candidate) => candidate.remote === ref.remote && candidate.number === ref.number)) {
    refs.push(ref);
  }
}

/**
 * Validate one persisted system link entry. The declared type says these are
 * well-formed; persisted rows written by older clients or hand-edited YAML may
 * not be, so the shape is re-checked at runtime rather than trusted.
 */
function toGithubReference(entry: unknown): GithubReference | null {
  if (!entry || typeof entry !== 'object') return null;
  if (!('remote' in entry) || !('number' in entry)) return null;
  const { remote, number } = entry;
  if (typeof remote !== 'string') return null;
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number <= 0) return null;
  return { remote: remote.toLowerCase(), number };
}

/**
 * All GitHub references carried by a tracker record, from both an explicit
 * system link collection and any field value accepted by the supplied parser.
 * Field values may arrive as JSON strings on SQLite — parse defensively.
 */
export function getRecordGithubReferences(
  record: TrackerRecord,
  parseUrl: (url: string) => GithubReference | null,
  systemLinkKey: GithubSystemLinkKey,
): GithubReference[] {
  const refs: GithubReference[] = [];
  const linked = record.system[systemLinkKey];
  for (const entry of Array.isArray(linked) ? linked : []) {
    const ref = toGithubReference(entry);
    if (ref) pushUnique(refs, ref);
  }

  for (let value of Object.values(record.fields)) {
    if (typeof value === 'string' && value.startsWith('{')) {
      try { value = JSON.parse(value); } catch { /* plain string, fall through */ }
    }
    if (typeof value === 'string') {
      const ref = parseUrl(value);
      if (ref) pushUnique(refs, ref);
    } else if (value && typeof value === 'object' && typeof (value as { url?: unknown }).url === 'string') {
      const ref = parseUrl((value as { url: string }).url);
      if (ref) pushUnique(refs, ref);
    }
  }

  return refs;
}
