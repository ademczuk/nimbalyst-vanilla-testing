/**
 * The knowledge graph's reading of a tracker room: `entity` pages with a
 * `kind`, `claim` statements between them, the market tree, dated facts, and
 * the content problems a reader can act on (stale facts, products with no
 * market or maker, duplicates).
 *
 * The vocabulary is the knowledge ontology's shared contract (r1 + r2):
 * `in-market`, `made-by`, `competes-with`, fact predicates carrying `asOf` and
 * an optional `asOfPrecision`. Pure, so the wiki home and the ontology
 * inspector report the same counts from the same function.
 */
import {
  byTitle,
  ontologyFieldValue,
  ontologyRecordTitle,
  recordRefs,
  stringList,
  type OntologyRecordLike,
} from './ontologyRecords';

export const ENTITY_TYPE = 'entity';
export const CLAIM_TYPE = 'claim';
/** Kinds that hold pages which say nothing about what the thing is. */
export const CATCH_ALL_KINDS: ReadonlySet<string> = new Set(['concept']);
/** Kinds that are page structure (navigation), not a statement about the thing. */
export const STRUCTURE_KINDS: ReadonlySet<string> = new Set(['area', 'home']);
/** Competitor fields contract r1 moves into `competes-with` qualifiers. Kept in the schema, not read. */
export const DEPRECATED_ENTITY_FIELDS: ReadonlySet<string> = new Set(['group', 'overlap', 'difference', 'threat', 'reviewedAt']);
export const FACT_PREDICATES: ReadonlySet<string> = new Set([
  'annual-revenue', 'funding-total', 'valuation', 'last-round', 'headcount', 'founded', 'hq',
  'pricing', 'license', 'platforms', 'launched', 'users', 'lifecycle',
]);
export const STALE_FACT_DAYS = 90;
/** A market with more products than this is worth splitting. */
export const OVERFULL_MARKET = 15;
const DUPLICATE_TYPES: ReadonlySet<string> = new Set([ENTITY_TYPE, 'competitor']);
const DAY_MS = 24 * 60 * 60 * 1000;

export function entityKind(record: OntologyRecordLike): string {
  const kind = ontologyFieldValue(record, 'kind');
  return typeof kind === 'string' && kind ? kind : 'other';
}

export function claimPredicate(claim: OntologyRecordLike): string | null {
  const value = ontologyFieldValue(claim, 'predicate');
  return typeof value === 'string' && value ? value : null;
}

/** A claim's qualifiers as an object; tolerant of a JSON-string value. */
export function claimQualifiers(claim: OntologyRecordLike): Record<string, unknown> {
  const value = ontologyFieldValue(claim, 'qualifiers');
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string' && value.trim().startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // An unreadable qualifier bag reads as none; the claim still counts.
    }
  }
  return {};
}

/** The live knowledge graph, indexed once. Archived items resolve through `allById` (citations may point at them). */
export interface KnowledgeGraph<T extends OntologyRecordLike = OntologyRecordLike> {
  live: T[];
  byId: ReadonlyMap<string, T>;
  allById: ReadonlyMap<string, T>;
  entities: T[];
  claims: T[];
  claimsBySubject: ReadonlyMap<string, T[]>;
  claimsByObject: ReadonlyMap<string, T[]>;
}

function pushTo<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function buildKnowledgeGraph<T extends OntologyRecordLike>(records: readonly T[]): KnowledgeGraph<T> {
  const live = records.filter((record) => !record.archived);
  const byId = new Map(live.map((record) => [record.id, record]));
  const allById = new Map(records.map((record) => [record.id, record]));
  const entities = live.filter((record) => record.primaryType === ENTITY_TYPE);
  const claims = live.filter((record) => record.primaryType === CLAIM_TYPE);
  const claimsBySubject = new Map<string, T[]>();
  const claimsByObject = new Map<string, T[]>();
  for (const claim of claims) {
    for (const id of recordRefs(claim, 'subject')) pushTo(claimsBySubject, id, claim);
    for (const id of recordRefs(claim, 'object')) pushTo(claimsByObject, id, claim);
  }
  return { live, byId, allById, entities, claims, claimsBySubject, claimsByObject };
}

export function hasKnowledgeTypes(typeNames: Iterable<string>): boolean {
  const names = new Set(typeNames);
  return names.has(ENTITY_TYPE) && names.has(CLAIM_TYPE);
}

// ---------------------------------------------------------------------------
// Markets
// ---------------------------------------------------------------------------

export interface MarketNode<T extends OntologyRecordLike = OntologyRecordLike> {
  record: T;
  children: Array<MarketNode<T>>;
  /** Pages with an `in-market` claim naming this market. */
  direct: T[];
  /** Distinct pages in this market or any market beneath it. */
  total: number;
  empty: boolean;
  overfull: boolean;
}

/** `kind: market` entities as a tree by `parent`; a market whose parent is not a market is a root. */
export function buildMarketTree<T extends OntologyRecordLike>(graph: KnowledgeGraph<T>): Array<MarketNode<T>> {
  const markets = graph.entities.filter((entity) => entityKind(entity) === 'market');
  const marketIds = new Set(markets.map((market) => market.id));
  const children = new Map<string, T[]>();
  const roots: T[] = [];
  for (const market of markets) {
    const parent = recordRefs(market, 'parent')[0];
    if (parent && marketIds.has(parent) && parent !== market.id) pushTo(children, parent, market);
    else roots.push(market);
  }
  const membersOf = (market: T): T[] => {
    const members = new Map<string, T>();
    for (const claim of graph.claimsByObject.get(market.id) ?? []) {
      if (claimPredicate(claim) !== 'in-market') continue;
      for (const id of recordRefs(claim, 'subject')) {
        const page = graph.byId.get(id);
        if (page) members.set(id, page);
      }
    }
    return [...members.values()].sort(byTitle);
  };
  const build = (market: T, lineage: ReadonlySet<string>): { node: MarketNode<T>; ids: Set<string> } => {
    const direct = membersOf(market);
    const ids = new Set(direct.map((page) => page.id));
    const nextLineage = new Set(lineage).add(market.id);
    const kids: Array<MarketNode<T>> = [];
    for (const child of [...(children.get(market.id) ?? [])].sort(byTitle)) {
      if (nextLineage.has(child.id)) continue;
      const built = build(child, nextLineage);
      for (const id of built.ids) ids.add(id);
      kids.push(built.node);
    }
    return { node: { record: market, children: kids, direct, total: ids.size, empty: ids.size === 0, overfull: direct.length > OVERFULL_MARKET }, ids };
  };
  const reached = new Set<string>();
  const walk = (node: MarketNode<T>) => { reached.add(node.record.id); node.children.forEach(walk); };
  const tree = [...roots].sort(byTitle).map((root) => build(root, new Set()).node);
  tree.forEach(walk);
  // A cycle of markets has no root; surface its members rather than losing them.
  for (const market of [...markets].sort(byTitle)) {
    if (reached.has(market.id)) continue;
    const node = build(market, new Set()).node;
    walk(node);
    tree.push(node);
  }
  return tree;
}

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

export type AsOfPrecision = 'day' | 'month' | 'year';

function asOfParts(value: unknown): [number, number, number] | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/.exec(value.trim());
  if (!match) return null;
  return [Number(match[1]), match[2] ? Number(match[2]) - 1 : 0, match[3] ? Number(match[3]) : 1];
}

/** When a fact dated `asOf` goes stale: `days` after the end of its period (the day, month or year). */
export function factStaleAt(asOf: unknown, precision: unknown, days = STALE_FACT_DAYS): number | null {
  const parts = asOfParts(asOf);
  if (!parts) return null;
  const [year, month, day] = parts;
  const end = precision === 'year' ? Date.UTC(year, 11, 31)
    : precision === 'month' ? Date.UTC(year, month + 1, 0)
      : Date.UTC(year, month, day);
  return end + days * DAY_MS;
}

export interface FactValue<T extends OntologyRecordLike = OntologyRecordLike> {
  subject: T;
  predicate: string;
  claim: T;
  /** Null when the claim carries no `asOf`, which the contract requires. */
  asOf: string | null;
  precision: AsOfPrecision;
  /** `undated` has no `asOf`; `stale` is past its threshold; `current` is neither. */
  state: 'current' | 'stale' | 'undated';
}

/** The current value of every fact: per subject and predicate, the asserted claim with the latest `asOf`. */
export function currentFacts<T extends OntologyRecordLike>(graph: KnowledgeGraph<T>, now: number, days = STALE_FACT_DAYS): Array<FactValue<T>> {
  const current = new Map<string, { value: FactValue<T>; sortKey: number }>();
  for (const claim of graph.claims) {
    const predicate = claimPredicate(claim);
    if (!predicate || !FACT_PREDICATES.has(predicate)) continue;
    const status = ontologyFieldValue(claim, 'status');
    if (status !== undefined && status !== 'asserted') continue;
    const subject = graph.byId.get(recordRefs(claim, 'subject')[0] ?? '');
    if (!subject) continue;
    const qualifiers = claimQualifiers(claim);
    const precision: AsOfPrecision = qualifiers.asOfPrecision === 'month' || qualifiers.asOfPrecision === 'year' ? qualifiers.asOfPrecision : 'day';
    const parts = asOfParts(qualifiers.asOf);
    const sortKey = parts ? Date.UTC(parts[0], parts[1], parts[2]) : -Infinity;
    const staleAt = factStaleAt(qualifiers.asOf, precision, days);
    const value: FactValue<T> = {
      subject,
      predicate,
      claim,
      asOf: parts ? String(qualifiers.asOf) : null,
      precision,
      state: staleAt === null ? 'undated' : now > staleAt ? 'stale' : 'current',
    };
    const key = `${subject.id}\u001f${predicate}`;
    const previous = current.get(key);
    if (!previous || sortKey > previous.sortKey) current.set(key, { value, sortKey });
  }
  return [...current.values()]
    .map(({ value }) => value)
    .sort((a, b) => byTitle(a.subject, b.subject) || a.predicate.localeCompare(b.predicate));
}

// ---------------------------------------------------------------------------
// Content health
// ---------------------------------------------------------------------------

export type ContentHealthCheck = 'stale-facts' | 'missing-market' | 'missing-maker' | 'missing-competes-with' | 'duplicates';

export interface HealthItem<T extends OntologyRecordLike = OntologyRecordLike> {
  /** Stable across renders and sessions: an Improve request and its proposal carry it. */
  id: string;
  check: string;
  title: string;
  detail: string;
  /**
   * What `count` counts: items for most checks, facts for `stale-facts` (one
   * page can hold several), groups for `duplicates`, links for `broken-links`.
   */
  count: number;
  /** The items the problem is about, for links. */
  items: T[];
  /** Ids of `items`, in order: what a search or filter over the affected items takes. */
  itemIds: string[];
  /** Duplicates only: the records that look like one thing, the one to keep first. */
  groups?: T[][];
  /** Ids of `groups`, in the same shape. */
  groupIds?: string[][];
}

/** A health item before its ids are derived from its records. */
export type HealthDraft<T extends OntologyRecordLike = OntologyRecordLike> = Omit<HealthItem<T>, 'itemIds' | 'groupIds'>;

export function withHealthIds<T extends OntologyRecordLike>(draft: HealthDraft<T>): HealthItem<T> {
  return {
    ...draft,
    itemIds: draft.items.map((item) => item.id),
    ...(draft.groups ? { groupIds: draft.groups.map((group) => group.map((item) => item.id)) } : {}),
  };
}

function normalizedName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function namesOf(record: OntologyRecordLike): string[] {
  return [ontologyRecordTitle(record), ...stringList(ontologyFieldValue(record, 'aliases'))]
    .map(normalizedName)
    .filter((name) => name.length >= 2);
}

/** Live records whose title or an alias matches another's, across entity and competitor items. */
export function findDuplicateGroups<T extends OntologyRecordLike>(graph: KnowledgeGraph<T>): T[][] {
  const candidates = graph.live.filter((record) => DUPLICATE_TYPES.has(record.primaryType)
    && !(record.primaryType === ENTITY_TYPE && STRUCTURE_KINDS.has(entityKind(record))));
  const parent = new Map<string, string>(candidates.map((record) => [record.id, record.id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  const owner = new Map<string, string>();
  for (const record of candidates) {
    for (const name of namesOf(record)) {
      const other = owner.get(name);
      if (other) parent.set(find(record.id), find(other));
      else owner.set(name, record.id);
    }
  }
  const groups = new Map<string, T[]>();
  for (const record of candidates) pushTo(groups, find(record.id), record);
  const rank = (record: T) => (record.primaryType === ENTITY_TYPE ? 0 : 1);
  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => group.sort((a, b) => rank(a) - rank(b) || byTitle(a, b)))
    .sort((a, b) => byTitle(a[0]!, b[0]!));
}

function hasClaim(graph: KnowledgeGraph, id: string, predicate: string, ends: 'subject' | 'either'): boolean {
  const asSubject = (graph.claimsBySubject.get(id) ?? []).some((claim) => claimPredicate(claim) === predicate);
  if (asSubject || ends === 'subject') return asSubject;
  return (graph.claimsByObject.get(id) ?? []).some((claim) => claimPredicate(claim) === predicate);
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

export interface ContentHealthOptions {
  now: number;
  /** Stale threshold in days after the end of a fact's period. Default 90. */
  staleDays?: number;
  /** Include products with no `competes-with` claim. The wiki home leaves it out; the inspector includes it. */
  includeCompetesWith?: boolean;
}

/**
 * Problems with the graph's content, each with a count and the items it is
 * about: stale or undated facts, products with no market or maker, and likely
 * duplicates. Checks with nothing to report are omitted. Returns nothing when
 * the room has no knowledge types.
 */
export function computeContentHealth<T extends OntologyRecordLike>(
  records: readonly T[] | KnowledgeGraph<T>,
  options: ContentHealthOptions,
): Array<HealthItem<T>> {
  const graph = Array.isArray(records) ? buildKnowledgeGraph(records as readonly T[]) : records as KnowledgeGraph<T>;
  const items: Array<HealthDraft<T>> = [];

  const facts = currentFacts(graph, options.now, options.staleDays ?? STALE_FACT_DAYS).filter((fact) => fact.state !== 'current');
  if (facts.length) {
    const undated = facts.filter((fact) => fact.state === 'undated').length;
    items.push({
      id: 'stale-facts',
      check: 'stale-facts',
      title: `${plural(facts.length, 'fact')} out of date`,
      detail: `${plural(facts.length - undated, 'current value')} past ${options.staleDays ?? STALE_FACT_DAYS} days after its as-of period${undated ? `, ${undated} with no as-of date` : ''}. Research a newer value and cite it.`,
      count: facts.length,
      items: [...new Map(facts.map((fact) => [fact.subject.id, fact.subject])).values()],
    });
  }

  const products = graph.entities.filter((entity) => entityKind(entity) === 'product').sort(byTitle);
  const missing: Array<[ContentHealthCheck, string, string, (page: T) => boolean]> = [
    ['missing-market', 'with no market', 'Add an in-market claim to a market page.', (page) => !hasClaim(graph, page.id, 'in-market', 'subject')],
    ['missing-maker', 'with no maker', 'Add a made-by claim to the organization that builds it.', (page) => !hasClaim(graph, page.id, 'made-by', 'subject')],
  ];
  if (options.includeCompetesWith) {
    missing.push(['missing-competes-with', 'with no competes-with', 'Say who it competes with, in which market, and how much of a threat it is.', (page) => !hasClaim(graph, page.id, 'competes-with', 'either')]);
  }
  for (const [check, suffix, detail, test] of missing) {
    const pages = products.filter(test);
    if (pages.length) items.push({ id: check, check, title: `${plural(pages.length, 'product')} ${suffix}`, detail, count: pages.length, items: pages });
  }

  const duplicates = findDuplicateGroups(graph);
  if (duplicates.length) {
    items.push({
      id: 'duplicates',
      check: 'duplicates',
      title: plural(duplicates.length, 'likely duplicate'),
      detail: 'Items whose title or alias matches another, including competitor tracker items that repeat a wiki page.',
      count: duplicates.length,
      items: duplicates.flat(),
      groups: duplicates,
    });
  }
  return items.map(withHealthIds);
}
