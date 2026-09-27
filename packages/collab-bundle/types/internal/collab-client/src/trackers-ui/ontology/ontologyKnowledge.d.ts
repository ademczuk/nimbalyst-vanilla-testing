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
import { type OntologyRecordLike } from './ontologyRecords';
export declare const ENTITY_TYPE = "entity";
export declare const CLAIM_TYPE = "claim";
/** Kinds that hold pages which say nothing about what the thing is. */
export declare const CATCH_ALL_KINDS: ReadonlySet<string>;
/** Kinds that are page structure (navigation), not a statement about the thing. */
export declare const STRUCTURE_KINDS: ReadonlySet<string>;
/** Competitor fields contract r1 moves into `competes-with` qualifiers. Kept in the schema, not read. */
export declare const DEPRECATED_ENTITY_FIELDS: ReadonlySet<string>;
export declare const FACT_PREDICATES: ReadonlySet<string>;
export declare const STALE_FACT_DAYS = 90;
/** A market with more products than this is worth splitting. */
export declare const OVERFULL_MARKET = 15;
export declare function entityKind(record: OntologyRecordLike): string;
export declare function claimPredicate(claim: OntologyRecordLike): string | null;
/** A claim's qualifiers as an object; tolerant of a JSON-string value. */
export declare function claimQualifiers(claim: OntologyRecordLike): Record<string, unknown>;
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
export declare function buildKnowledgeGraph<T extends OntologyRecordLike>(records: readonly T[]): KnowledgeGraph<T>;
export declare function hasKnowledgeTypes(typeNames: Iterable<string>): boolean;
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
export declare function buildMarketTree<T extends OntologyRecordLike>(graph: KnowledgeGraph<T>): Array<MarketNode<T>>;
export type AsOfPrecision = 'day' | 'month' | 'year';
/** When a fact dated `asOf` goes stale: `days` after the end of its period (the day, month or year). */
export declare function factStaleAt(asOf: unknown, precision: unknown, days?: number): number | null;
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
export declare function currentFacts<T extends OntologyRecordLike>(graph: KnowledgeGraph<T>, now: number, days?: number): Array<FactValue<T>>;
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
export declare function withHealthIds<T extends OntologyRecordLike>(draft: HealthDraft<T>): HealthItem<T>;
/** Live records whose title or an alias matches another's, across entity and competitor items. */
export declare function findDuplicateGroups<T extends OntologyRecordLike>(graph: KnowledgeGraph<T>): T[][];
export declare function plural(count: number, one: string, many?: string): string;
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
export declare function computeContentHealth<T extends OntologyRecordLike>(records: readonly T[] | KnowledgeGraph<T>, options: ContentHealthOptions): Array<HealthItem<T>>;
