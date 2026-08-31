/**
 * "Have I already filed this?" — scored over two independent arms.
 *
 * Arm A is lexical: a Dice coefficient over stopword-stripped title tokens.
 * It runs per keystroke against records already in memory, needs no network,
 * and is the entire feature for the majority of users, for whom the memory
 * extension is off.
 *
 * Arm B is semantic: dense-embedding neighbours of the title. It is the arm
 * that catches "app freezes when typing" against "editor hangs on input" —
 * no shared tokens, same bug.
 *
 * The gates are deliberately tight. A strip that shows noise trains people to
 * ignore it, and an ignored strip is worse than no strip: it costs a glance on
 * every capture and buys nothing.
 *
 * Pure. No clock, no I/O, no registry lookups.
 */

/** One row of the in-memory title index the strip matches against. */
export interface DuplicateIndexEntry {
  id: string;
  title: string;
  /** Primary tracker type, for the row's icon. */
  type: string;
  /** Current workflow status. Done/closed items are eligible and shown as such. */
  status?: string;
  /** Team key or local number, already formatted. */
  displayKey?: string;
  /** False for a local number — the row must never present one as a shared key. */
  keyIsShared?: boolean;
  /** Epoch ms; breaks ties toward the item someone touched most recently. */
  updatedAt?: number;
}

/** A `semantic-search:query` hit, joined back to the index by `refId`. */
export interface SemanticDuplicateHit {
  refId: string;
  /** Raw dense cosine. Fused RRF ranks are NOT comparable across queries. */
  cosine?: number;
}

export type DuplicateArm = 'lexical' | 'semantic';

export interface DuplicateMatch {
  entry: DuplicateIndexEntry;
  /** Normalized 0..1; the higher of the two arms when both matched. */
  score: number;
  arms: DuplicateArm[];
}

export interface ScoreTrackerDuplicatesOptions {
  /** Nothing shows below this many characters of title. */
  minTitleLength?: number;
  /** …or below this many content tokens. */
  minTokens?: number;
  lexicalFloor?: number;
  /**
   * Calibrated cosine floor for Arm B. The placeholder came from taste; the
   * shipped number comes from the offline calibration pass over a real
   * workspace, recorded in the plan.
   */
  semanticFloor?: number;
  limit?: number;
  /** Never suggest the item being edited (unused on create, kept for reuse). */
  excludeId?: string;
}

export const DUPLICATE_DEFAULTS = {
  minTitleLength: 12,
  minTokens: 3,
  lexicalFloor: 0.45,
  semanticFloor: 0.72,
  limit: 3,
} as const;

/**
 * Words that carry no signal in an issue title. Kept short on purpose: an
 * aggressive list strips the very words that distinguish two similar bugs.
 */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'has', 'have',
  'if', 'in', 'into', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'then', 'this',
  'to', 'was', 'were', 'when', 'with', 'we', 'you',
]);

/** Lowercase, strip punctuation, drop stopwords and single characters. */
export function tokenizeTitle(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

/** Dice coefficient over two token sets: 2|A∩B| / (|A|+|B|). */
export function diceCoefficient(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

export function scoreTrackerDuplicates(
  index: DuplicateIndexEntry[],
  query: string,
  semanticHits: SemanticDuplicateHit[] = [],
  options: ScoreTrackerDuplicatesOptions = {},
): DuplicateMatch[] {
  const {
    minTitleLength = DUPLICATE_DEFAULTS.minTitleLength,
    minTokens = DUPLICATE_DEFAULTS.minTokens,
    lexicalFloor = DUPLICATE_DEFAULTS.lexicalFloor,
    semanticFloor = DUPLICATE_DEFAULTS.semanticFloor,
    limit = DUPLICATE_DEFAULTS.limit,
    excludeId,
  } = options;

  const trimmed = query.trim();
  if (trimmed.length < minTitleLength) return [];

  const queryTokens = tokenizeTitle(trimmed);
  if (queryTokens.length < minTokens) return [];
  const querySet = new Set(queryTokens);

  const byId = new Map<string, DuplicateIndexEntry>();
  for (const entry of index) {
    if (entry.id === excludeId) continue;
    byId.set(entry.id, entry);
  }

  const merged = new Map<string, DuplicateMatch>();
  const record = (entry: DuplicateIndexEntry, score: number, arm: DuplicateArm): void => {
    const existing = merged.get(entry.id);
    if (!existing) {
      merged.set(entry.id, { entry, score, arms: [arm] });
      return;
    }
    existing.score = Math.max(existing.score, score);
    if (!existing.arms.includes(arm)) existing.arms.push(arm);
  };

  for (const entry of byId.values()) {
    const score = diceCoefficient(querySet, new Set(tokenizeTitle(entry.title)));
    if (score >= lexicalFloor) record(entry, score, 'lexical');
  }

  for (const hit of semanticHits) {
    const entry = byId.get(hit.refId);
    if (!entry) continue;
    if (typeof hit.cosine !== 'number' || hit.cosine < semanticFloor) continue;
    record(entry, hit.cosine, 'semantic');
  }

  return Array.from(merged.values())
    .sort((a, b) => (b.score - a.score) || ((b.entry.updatedAt ?? 0) - (a.entry.updatedAt ?? 0)))
    .slice(0, limit);
}
