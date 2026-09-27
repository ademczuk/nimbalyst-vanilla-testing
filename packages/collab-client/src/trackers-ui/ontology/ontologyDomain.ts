/**
 * The ontology inspector's main reading: "what does our team keep track of,
 * and how do those things relate?"
 *
 * `analyzeOntology` describes the schema (types, fields, predicates). This
 * describes the domain: categories a person would name (competitors, markets,
 * companies, capabilities, customers, bugs), how completely each named
 * relationship between them is recorded, and the gaps worth fixing, each in
 * domain words. Roles are derived, not declared: a competitor is a product
 * that is the object of `competes-with` from us, not a page type.
 *
 * Pure and host-agnostic, like the rest of this directory: desktop settings and
 * the web console's Tracker setup screen render the same model.
 */
import type { FieldDefinition, TrackerDataModel } from '@nimbalyst/tracker-schema';
import { summarizeTypes, SPARSE_FILL_RATE, type OntologyInput, type TypeSummary } from './ontologyAnalysis';
import { buildCategoryDetail } from './ontologyDomainDetail';
import {
  GROUP_COPY,
  KNOWLEDGE_COPY,
  KIND_CATEGORY,
  WORK_COPY,
  PERSONA_COPY,
  TYPE_CHIP_NAMES,
  HIDDEN_TYPES,
  FIELD_VERBS,
  KEY_VERBS,
  PREDICATE_VERBS,
  BUILT_ON,
  SIZE_FACTS,
  FACT_NOUNS,
  THREAT_RANK,
  INACTIVE_CLAIM,
  CLOSED_CATEGORIES,
  formatCount,
  capitalize,
  singularVerb,
  nameList,
  humanize,
  fill,
  type CategoryCopy,
  type DomainGroupId,
} from './ontologyDomainVocabulary';
import { buildSummary } from './ontologyDomainSummary';
import {
  buildKnowledgeGraph,
  buildMarketTree,
  CATCH_ALL_KINDS,
  claimPredicate,
  claimQualifiers,
  CLAIM_TYPE,
  currentFacts,
  ENTITY_TYPE,
  entityKind,
  findDuplicateGroups,
  hasKnowledgeTypes,
  plural,
  STALE_FACT_DAYS,
  STRUCTURE_KINDS,
  withHealthIds,
  type FactValue,
  type HealthItem,
  type KnowledgeGraph,
  type MarketNode,
} from './ontologyKnowledge';
import { byTitle, isEmptyFieldValue, ontologyFieldValue, ontologyRecordTitle, recordRefs, type OntologyRecordLike } from './ontologyRecords';

export type { DomainGroupId };
export const DOMAIN_GROUP_ORDER: readonly DomainGroupId[] = ['market', 'product', 'customers', 'work'];

/** `full` is (nearly) every member; `low` under 60%; `untracked` means nothing can record it yet. */
export type LineState = 'full' | 'partial' | 'low' | 'untracked';

export interface DomainLine {
  /** `${categoryId}:${key}` */
  id: string;
  /** Plural present tense, read after the category name: "Competitors *sit in* markets". */
  verb: string;
  /** The category at the other end; null for an attribute ("have a threat level"). */
  targetId: string | null;
  /** Members with at least one link. */
  have: number;
  total: number;
  /** Links across all members. */
  links: number;
  rate: number;
  state: LineState;
  /** Members without the link, for the gap and the table. */
  missingIds: string[];
  /** How a member that lacks it reads, for a gap title: "have no known maker". */
  missing: string | null;
  /** What records it, in schema words, for the "how this is stored" disclosure. */
  via: string;
  gapId: string | null;
}

export type StoredPart = { text: string; code?: boolean };

export interface SchemaRow {
  label: string;
  /** Null when the value is not a per-item fill (an inverse field, say). */
  filled: number | null;
  total: number;
  /** An old field being retired, still shown so its values are not forgotten. */
  retired: boolean;
}

export interface DomainSchema {
  stored: StoredPart[];
  rows: SchemaRow[];
}

export interface MemberCell {
  text: string;
  tone?: 'warn' | 'faint';
  /** A threat level, rendered as a pill. */
  threat?: string;
}

export interface MemberRow {
  id: string;
  cells: MemberCell[];
}

export interface MemberTable {
  columns: string[];
  rows: MemberRow[];
}

export interface DomainCategory<T extends OntologyRecordLike = OntologyRecordLike> {
  id: string;
  name: string;
  singular: string;
  group: DomainGroupId;
  role: string;
  blurb: string;
  /** The headline number: open items for work trackers, every member otherwise. */
  count: number;
  /** "open" when `count` is the open subset of `total`. */
  countLabel: string | null;
  total: number;
  /** The product everything else is recorded relative to. */
  us: boolean;
  /** Suggested, not tracked: rendered dashed, and opening it proposes tracking it. */
  ghost: boolean;
  /** Most connected first. */
  members: T[];
  /** One line of examples for the card. */
  example: string;
  lines: DomainLine[];
  gapIds: string[];
  /** A secondary line under the relationship list ("Threat: 1 critical, 16 high"). */
  note: string | null;
  schema: DomainSchema | null;
  table: MemberTable;
}

export type DomainGapTone = 'gap' | 'opportunity';

/** A gap is a health item, so the existing proposal request and open-proposal lookup take it as is. */
export interface DomainGap<T extends OntologyRecordLike = OntologyRecordLike> extends HealthItem<T> {
  tone: DomainGapTone;
  categoryIds: string[];
}

export interface DomainEdge {
  id: string;
  from: string;
  to: string;
  verb: string;
  links: number;
  have: number;
  total: number;
  /** `weak` is possible but rarely used; `missing` is a link nothing records yet. */
  state: 'recorded' | 'weak' | 'missing';
  gapId: string | null;
}

export type SummaryPart = { text: string; categoryId?: string };

export interface DomainModel<T extends OntologyRecordLike = OntologyRecordLike> {
  us: T | null;
  categories: Array<DomainCategory<T>>;
  groups: Array<{ id: DomainGroupId; label: string; question: string; categoryIds: string[] }>;
  /** Everything else with items, as chips. */
  also: Array<{ id: string; name: string; count: number }>;
  /** The plain sentence at the top, with clickable counts. */
  summary: SummaryPart[];
  meta: { pages: number; statements: number; types: number; lastChange: string | null };
  gaps: Array<DomainGap<T>>;
  edges: DomainEdge[];
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

/** One line while it is being built: the line and, per member, what it links to. */
export interface LineCalc {
  line: DomainLine;
  /** Member id -> target ids (or attribute values for a line with no target). */
  targets: Map<string, string[]>;
  /** Identifies the link itself, so the two ends of one link draw one edge. */
  linkKey: string;
  /** The end that draws the edge and owns the gap. */
  owner: boolean;
}

interface LineSpec {
  key: string;
  verb: string;
  targetId: string | null;
  targets: Map<string, string[]>;
  via: string;
  linkKey: string;
  owner?: boolean;
  missing?: string | null;
  untracked?: boolean;
}

function makeLine(categoryId: string, members: readonly OntologyRecordLike[], spec: LineSpec): LineCalc {
  let have = 0;
  let links = 0;
  const missingIds: string[] = [];
  for (const member of members) {
    const found = spec.targets.get(member.id)?.length ?? 0;
    links += found;
    if (found) have += 1;
    else missingIds.push(member.id);
  }
  const total = members.length;
  const rate = total ? have / total : 0;
  const state: LineState = spec.untracked || total === 0 ? 'untracked' : rate >= 0.98 ? 'full' : rate < 0.6 ? 'low' : 'partial';
  return {
    line: { id: `${categoryId}:${spec.key}`, verb: spec.verb, targetId: spec.targetId, have, total, links, rate, state, missingIds, missing: spec.missing ?? null, via: spec.via, gapId: null },
    targets: spec.targets,
    linkKey: spec.linkKey,
    owner: spec.owner ?? true,
  };
}

function isActiveClaim(claim: OntologyRecordLike): boolean {
  const status = ontologyFieldValue(claim, 'status');
  return typeof status !== 'string' || !INACTIVE_CLAIM.has(status);
}

/** Item ids at the other end of `predicates` claims from `id`, in the direction asked. */
function claimEnds(graph: KnowledgeGraph, id: string, predicates: readonly string[], dir: 'out' | 'in' | 'both'): string[] {
  const wanted = new Set(predicates);
  const ends: string[] = [];
  if (dir !== 'in') {
    for (const claim of graph.claimsBySubject.get(id) ?? []) {
      if (isActiveClaim(claim) && wanted.has(claimPredicate(claim) ?? '')) ends.push(...recordRefs(claim, 'object'));
    }
  }
  if (dir !== 'out') {
    for (const claim of graph.claimsByObject.get(id) ?? []) {
      if (isActiveClaim(claim) && wanted.has(claimPredicate(claim) ?? '')) ends.push(...recordRefs(claim, 'subject'));
    }
  }
  return ends;
}

function workOpen(model: TrackerDataModel | undefined, record: OntologyRecordLike): boolean {
  const statusField = model?.roles?.workflowStatus ?? 'status';
  const value = ontologyFieldValue(record, statusField);
  const option = model?.fields.find((field) => field.name === statusField)?.options?.find((entry) => entry.value === value);
  const category = (option as { category?: string } | undefined)?.category;
  return !category || !CLOSED_CATEGORIES.has(category);
}

function hasClosedStatuses(model: TrackerDataModel | undefined): boolean {
  const statusField = model?.roles?.workflowStatus ?? 'status';
  return Boolean(model?.fields.find((field) => field.name === statusField)?.options
    ?.some((option) => CLOSED_CATEGORIES.has((option as { category?: string }).category ?? '')));
}

function statusBreakdown(model: TrackerDataModel | undefined, members: readonly OntologyRecordLike[]): string {
  const statusField = model?.roles?.workflowStatus ?? 'status';
  const options = model?.fields.find((field) => field.name === statusField)?.options ?? [];
  const counts = new Map<string, number>();
  for (const member of members) {
    const value = ontologyFieldValue(member, statusField);
    if (typeof value === 'string' && value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  if (!counts.size) return '';
  const order = new Map(options.map((option, index) => [option.value, index]));
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (order.get(a[0]) ?? 99) - (order.get(b[0]) ?? 99))
    .slice(0, 4)
    .map(([value, count]) => `${formatCount(count)} ${(options.find((option) => option.value === value)?.label ?? value).toLowerCase()}`)
    .join(', ');
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

/** What the detail builder needs to know about the room, beyond one category. */
export interface DomainContext<T extends OntologyRecordLike = OntologyRecordLike> {
  graph: KnowledgeGraph<T>;
  models: ReadonlyMap<string, TrackerDataModel>;
  summaries: ReadonlyMap<string, TypeSummary<T>>;
  us: T | null;
  facts: Array<FactValue<T>>;
  markets: Array<MarketNode<T>>;
  /** Item id -> category id. */
  categoryOf: ReadonlyMap<string, string>;
  categoryName: (id: string) => string;
  /** The tracker type a work category reads, by category id. */
  workType: ReadonlyMap<string, string>;
  now: number;
}

interface Draft<T extends OntologyRecordLike> {
  copy: CategoryCopy;
  members: T[];
  count: number;
  countLabel: string | null;
  us: boolean;
  ghost: boolean;
  calcs: LineCalc[];
  example: string;
  note: string | null;
}

export function buildDomainModel<T extends OntologyRecordLike>(input: OntologyInput<T>): DomainModel<T> {
  const graph = buildKnowledgeGraph(input.records);
  const models = new Map(input.types.filter((model) => !model.archived).map((model) => [model.type, model]));
  const summaries = new Map(summarizeTypes(input.types, input.records).map((summary) => [summary.type, summary]));
  const liveByType = new Map<string, T[]>();
  for (const record of graph.live) {
    const list = liveByType.get(record.primaryType);
    if (list) list.push(record);
    else liveByType.set(record.primaryType, [record]);
  }
  const typeNames = [...models.keys(), ...liveByType.keys()];
  const knowledge = hasKnowledgeTypes(typeNames);
  const registry = new Map((input.predicates ?? []).map((predicate) => [predicate.id, predicate]));
  const facts = knowledge ? currentFacts(graph, input.now, STALE_FACT_DAYS) : [];
  const marketTree = knowledge ? buildMarketTree(graph) : [];

  // -- Who we are, and who competes with us --------------------------------
  const competesWith = graph.claims.filter((claim) => isActiveClaim(claim) && claimPredicate(claim) === 'competes-with');
  const subjectCounts = new Map<string, number>();
  for (const claim of competesWith) {
    const subject = recordRefs(claim, 'subject')[0];
    if (subject && graph.byId.get(subject)?.primaryType === ENTITY_TYPE) subjectCounts.set(subject, (subjectCounts.get(subject) ?? 0) + 1);
  }
  const usId = [...subjectCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  const us = usId ? graph.byId.get(usId)! : null;
  const usName = us ? ontologyRecordTitle(us) : 'the product';
  const ourSide = new Set<string>(us ? [us.id] : []);
  if (us) {
    for (const entity of graph.entities) {
      if (entityKind(entity) === 'capability') ourSide.add(entity.id);
    }
  }
  const competitorIds = new Set<string>();
  /** Competitor id -> the competes-with claims that make it one. */
  const rivalry = new Map<string, T[]>();
  for (const claim of competesWith) {
    const subject = recordRefs(claim, 'subject')[0];
    const object = recordRefs(claim, 'object')[0];
    const other = subject && ourSide.has(subject) ? object : object && ourSide.has(object) ? subject : undefined;
    if (!other || other === us?.id || graph.byId.get(other)?.primaryType !== ENTITY_TYPE) continue;
    competitorIds.add(other);
    const list = rivalry.get(other);
    if (list) list.push(claim);
    else rivalry.set(other, [claim]);
  }

  // -- Category membership --------------------------------------------------
  const categoryOf = new Map<string, string>();
  const knowledgeMembers = new Map<string, T[]>();
  const leftovers = new Map<string, T[]>();
  if (knowledge) {
    for (const entity of graph.entities) {
      const kind = entityKind(entity);
      if (STRUCTURE_KINDS.has(kind)) continue;
      const id = entity.id === us?.id ? 'us'
        : competitorIds.has(entity.id) ? 'competitors'
          : KIND_CATEGORY[kind] ?? null;
      if (!id) {
        const list = leftovers.get(kind);
        if (list) list.push(entity);
        else leftovers.set(kind, [entity]);
        continue;
      }
      categoryOf.set(entity.id, id);
      const list = knowledgeMembers.get(id);
      if (list) list.push(entity);
      else knowledgeMembers.set(id, [entity]);
    }
  }
  const workType = new Map<string, string>();
  for (const [type, copy] of Object.entries(WORK_COPY)) {
    const items = liveByType.get(type) ?? [];
    if (!items.length) continue;
    workType.set(copy.id, type);
    for (const item of items) categoryOf.set(item.id, copy.id);
  }
  const has = (id: string) => (knowledgeMembers.get(id)?.length ?? 0) > 0 || workType.has(id);

  // -- Opportunities: links the team would want and nothing records --------
  const personaTracked = typeNames.includes('persona') || graph.entities.some((entity) => entityKind(entity) === 'persona');
  const wantsPersonas = !personaTracked && (workType.has('customers') || workType.has('people'));
  const areaType = workType.get('areas');
  const capabilityAreaLinked = [...(knowledgeMembers.get('capabilities') ?? [])].some((page) =>
    [...(graph.claimsBySubject.get(page.id) ?? []), ...(graph.claimsByObject.get(page.id) ?? [])]
      .some((claim) => [...recordRefs(claim, 'subject'), ...recordRefs(claim, 'object')].some((id) => categoryOf.get(id) === 'areas')))
    || Boolean(areaType && models.get(areaType)?.fields.some((field) => relationshipField(field) && targetsOf(field).includes(ENTITY_TYPE)));
  const wantsCapabilityAreas = has('capabilities') && has('areas') && !capabilityAreaLinked;
  const competitorCapabilityLinked = [...competitorIds].some((id) =>
    [...(graph.claimsBySubject.get(id) ?? []), ...(graph.claimsByObject.get(id) ?? [])]
      .some((claim) => isActiveClaim(claim) && [...recordRefs(claim, 'subject'), ...recordRefs(claim, 'object')].some((end) => categoryOf.get(end) === 'capabilities')));
  const wantsCompetitorCapabilities = has('competitors') && has('capabilities') && !competitorCapabilityLinked;
  const OPP_PERSONA = 'track-personas';
  const OPP_CAPABILITY_AREAS = 'link-capabilities-areas';
  const OPP_COMPETITOR_CAPABILITIES = 'competitor-capabilities';
  const opportunityLine = (key: string, verb: string, targetId: string, gapId: string): LineSpec => ({
    key, verb, targetId, targets: new Map(), via: 'nothing records this yet', linkKey: `opp:${gapId}`, untracked: true,
  });

  // -- Knowledge categories -------------------------------------------------
  const drafts: Array<Draft<T>> = [];
  const byConnections = (a: T, b: T) => {
    const degree = (record: T) => (graph.claimsBySubject.get(record.id)?.length ?? 0) + (graph.claimsByObject.get(record.id)?.length ?? 0);
    return degree(b) - degree(a) || byTitle(a, b);
  };
  const predicateVerb = (predicate: string, dir: 'out' | 'in'): string => {
    const known = PREDICATE_VERBS[predicate];
    if (known) return dir === 'out' ? known[0] : known[1];
    const declared = registry.get(predicate);
    const label = dir === 'out' ? declared?.label : declared?.inverseLabel;
    return label ? label.toLowerCase() : dir === 'out' ? humanize(predicate) : `are the object of ${humanize(predicate)}`;
  };
  const claimLine = (members: readonly T[], key: string, predicates: string[], dir: 'out' | 'in' | 'both', targetId: string | null, extra: Partial<LineSpec> = {}): LineSpec => {
    const targets = new Map<string, string[]>();
    for (const member of members) {
      const ends = claimEnds(graph, member.id, predicates, dir)
        .filter((end) => !targetId || categoryOf.get(end) === targetId);
      if (ends.length) targets.set(member.id, [...new Set(ends)]);
    }
    const verb = extra.verb ?? predicateVerb(predicates[0]!, dir === 'in' ? 'in' : 'out');
    return {
      key,
      verb,
      targetId,
      targets,
      via: `${predicates.join(' / ')} statements`,
      linkKey: `claim:${[...predicates].sort().join('+')}`,
      owner: dir !== 'in',
      ...extra,
    };
  };
  const factLine = (members: readonly T[], key: string, predicates: string[], verb: string, missing: string | null): LineSpec => {
    const wanted = new Set(predicates);
    const targets = new Map<string, string[]>();
    for (const fact of facts) {
      if (!wanted.has(fact.predicate)) continue;
      const list = targets.get(fact.subject.id) ?? [];
      list.push(fact.predicate);
      targets.set(fact.subject.id, list);
    }
    return { key, verb, targetId: null, targets, via: `${predicates.join(', ')} facts`, linkKey: `fact:${key}`, missing };
  };
  const fieldLine = (members: readonly T[], key: string, field: string, verb: string): LineSpec => {
    const targets = new Map<string, string[]>();
    for (const member of members) {
      const value = ontologyFieldValue(member, field);
      if (!isEmptyFieldValue(value)) targets.set(member.id, [field]);
    }
    return { key, verb, targetId: null, targets, via: `the ${field} field`, linkKey: `field:${key}` };
  };

  if (knowledge) {
    if (us) {
      const self = [us];
      const calcs = [
        claimLine(self, 'competes-with', ['competes-with'], 'both', 'competitors', { verb: 'compete with' }),
        claimLine(self, 'in-market', ['in-market'], 'out', 'markets'),
        claimLine(self, 'made-by', ['made-by'], 'out', 'organizations'),
        claimLine(self, 'built-on', BUILT_ON, 'out', 'technologies', { verb: 'are built on' }),
        claimLine(self, 'parts', ['component-of'], 'in', 'capabilities', { owner: false }),
      ].map((spec) => makeLine('us', self, spec)).filter((calc) => calc.line.links > 0 || calc.line.id === 'us:competes-with');
      const markets = calcs.find((calc) => calc.line.id === 'us:in-market')?.targets.get(us.id) ?? [];
      drafts.push({
        copy: { id: 'us', name: usName, singular: usName, group: 'product', role: 'The product everything else is compared to', blurb: 'Our own product page. Competitors, markets, and technologies are all recorded relative to it.' },
        members: self, count: 1, countLabel: null, us: true, ghost: false, calcs,
        example: markets.map((id) => ontologyRecordTitle(graph.byId.get(id)!)).join(', ') || 'The product we compare to',
        note: null,
      });
    }

    const competitors = (knowledgeMembers.get('competitors') ?? []).slice();
    if (competitors.length) {
      const threatOf = (id: string): string | null => {
        let best: string | null = null;
        for (const claim of rivalry.get(id) ?? []) {
          const threat = claimQualifiers(claim).threat;
          if (typeof threat === 'string' && (THREAT_RANK[threat] ?? 0) > (THREAT_RANK[best ?? ''] ?? 0)) best = threat;
        }
        return best;
      };
      competitors.sort((a, b) => (THREAT_RANK[threatOf(b.id) ?? ''] ?? 0) - (THREAT_RANK[threatOf(a.id) ?? ''] ?? 0) || byConnections(a, b));
      const threats = new Map<string, string[]>();
      for (const member of competitors) {
        const threat = threatOf(member.id);
        if (threat) threats.set(member.id, [threat]);
      }
      const specs: LineSpec[] = [
        claimLine(competitors, 'in-market', ['in-market'], 'out', 'markets', { missing: 'sit in no market' }),
        claimLine(competitors, 'made-by', ['made-by'], 'out', 'organizations', { missing: 'have no known maker' }),
        { key: 'threat', verb: 'have a threat level', targetId: null, targets: threats, via: 'the threat qualifier on competes-with', linkKey: 'qualifier:threat', missing: 'have no threat level' },
        factLine(competitors, 'lifecycle', ['lifecycle'], 'have a status (active, defunct...)', 'have no recorded status'),
      ];
      if (wantsCompetitorCapabilities) specs.push(opportunityLine('capabilities', 'have which of our', 'capabilities', OPP_COMPETITOR_CAPABILITIES));
      const tally = new Map<string, number>();
      for (const [, [threat]] of threats) tally.set(threat!, (tally.get(threat!) ?? 0) + 1);
      const note = tally.size
        ? `Threat: ${Object.keys(THREAT_RANK).filter((level) => tally.has(level)).map((level) => `${tally.get(level)} ${level}`).join(', ')}`
        : null;
      drafts.push({
        copy: KNOWLEDGE_COPY.competitors!, members: competitors, count: competitors.length, countLabel: null, us: false, ghost: false,
        calcs: specs.map((spec) => makeLine('competitors', competitors, spec)),
        example: competitors.slice(0, 6).map(ontologyRecordTitle).join(', '),
        note,
      });
    }

    const markets = (knowledgeMembers.get('markets') ?? []).slice();
    if (markets.length) {
      const totals = new Map<string, number>();
      const walk = (node: MarketNode<T>) => { totals.set(node.record.id, node.total); node.children.forEach(walk); };
      marketTree.forEach(walk);
      markets.sort((a, b) => (totals.get(b.id) ?? 0) - (totals.get(a.id) ?? 0) || byTitle(a, b));
      const include = claimLine(markets, 'include', ['in-market'], 'in', 'competitors');
      // A parent market holds its products through its submarkets.
      for (const market of markets) {
        if (!include.targets.has(market.id) && (totals.get(market.id) ?? 0) > 0) include.targets.set(market.id, ['(through submarkets)']);
      }
      const leaves = markets.filter((market) => !markets.some((other) => recordRefs(other, 'parent')[0] === market.id));
      drafts.push({
        copy: KNOWLEDGE_COPY.markets!, members: markets, count: markets.length, countLabel: null, us: false, ghost: false,
        calcs: [include, fieldLine(markets, 'summary', 'summary', 'have a written summary')].map((spec) => makeLine('markets', markets, spec)),
        example: leaves.filter((market) => (totals.get(market.id) ?? 0) > 0).slice(0, 3).map((market) => `${ontologyRecordTitle(market)} (${totals.get(market.id)})`).join(', '),
        note: marketTree.length ? `${plural(marketTree.length, 'top-level group')}: ${marketTree.map((node) => ontologyRecordTitle(node.record)).join(', ')}` : null,
      });
    }

    const organizations = (knowledgeMembers.get('organizations') ?? []).slice();
    if (organizations.length) {
      const makes = claimLine(organizations, 'make', ['made-by'], 'in', 'competitors');
      const allMakes = claimLine(organizations, 'make-any', ['made-by'], 'in', null);
      organizations.sort((a, b) => (allMakes.targets.get(b.id)?.length ?? 0) - (allMakes.targets.get(a.id)?.length ?? 0) || byConnections(a, b));
      const size = factLine(organizations, 'size', SIZE_FACTS, 'have revenue or size facts', 'have no size or revenue');
      const orgFacts = facts.filter((fact) => categoryOf.get(fact.subject.id) === 'organizations');
      const staleCount = orgFacts.filter((fact) => fact.state === 'stale').length;
      drafts.push({
        copy: KNOWLEDGE_COPY.organizations!, members: organizations, count: organizations.length, countLabel: null, us: false, ghost: false,
        calcs: [makes, size].map((spec) => makeLine('organizations', organizations, spec)),
        example: organizations.slice(0, 6).map(ontologyRecordTitle).join(', '),
        note: orgFacts.length ? `${plural(orgFacts.length, 'fact')} in all${staleCount ? `; ${staleCount} older than ${STALE_FACT_DAYS} days` : ''}.` : null,
      });
    }

    const capabilities = (knowledgeMembers.get('capabilities') ?? []).slice().sort(byConnections);
    if (capabilities.length) {
      const specs: LineSpec[] = [
        claimLine(capabilities, 'part-of', ['component-of'], 'out', 'us'),
        claimLine(capabilities, 'built-on', BUILT_ON, 'out', 'technologies', { verb: 'are built on' }),
      ];
      if (wantsCapabilityAreas) specs.push(opportunityLine('areas', 'are tracked as', 'areas', OPP_CAPABILITY_AREAS));
      const unlinked = capabilities.filter((page) => !graph.claimsBySubject.get(page.id)?.length && !graph.claimsByObject.get(page.id)?.length).length;
      drafts.push({
        copy: KNOWLEDGE_COPY.capabilities!, members: capabilities, count: capabilities.length, countLabel: null, us: false, ghost: false,
        calcs: specs.map((spec) => makeLine('capabilities', capabilities, spec)),
        example: capabilities.slice(0, 4).map(ontologyRecordTitle).join(', '),
        note: unlinked ? `${unlinked} of ${capabilities.length} have no statements at all.` : null,
      });
    }

    const technologies = (knowledgeMembers.get('technologies') ?? []).slice().sort(byConnections);
    if (technologies.length) {
      const usedBy = claimLine(technologies, 'used-by', [...BUILT_ON, 'component-of'], 'in', null, { verb: 'are used by' });
      for (const [id, ends] of usedBy.targets) {
        const ours = ends.filter((end) => categoryOf.get(end) === 'us' || categoryOf.get(end) === 'capabilities');
        if (ours.length) usedBy.targets.set(id, ours);
        else usedBy.targets.delete(id);
      }
      // With no product page to point at, the capabilities that use it are the other end.
      usedBy.targetId = us ? 'us' : 'capabilities';
      usedBy.owner = false;
      const unlinked = technologies.filter((page) => !graph.claimsBySubject.get(page.id)?.length && !graph.claimsByObject.get(page.id)?.length).length;
      drafts.push({
        copy: KNOWLEDGE_COPY.technologies!, members: technologies, count: technologies.length, countLabel: null, us: false, ghost: false,
        calcs: [makeLine('technologies', technologies, usedBy)],
        example: technologies.slice(0, 5).map(ontologyRecordTitle).join(', '),
        note: unlinked ? `${unlinked} have no statements.` : null,
      });
    }
  }

  // -- Work trackers ---------------------------------------------------------
  for (const [categoryId, type] of workType) {
    const model = models.get(type);
    const items = (liveByType.get(type) ?? []).slice();
    const closable = hasClosedStatuses(model);
    const open = closable ? items.filter((item) => workOpen(model, item)) : items;
    const copy = WORK_COPY[type]!;
    const calcs: LineCalc[] = [];
    for (const field of model?.fields.filter(relationshipField) ?? []) {
      const targetCategory = targetsOf(field).map((target) => WORK_COPY[target]?.id).find((id) => id && id !== categoryId && workType.has(id));
      if (!targetCategory) continue;
      const targetType = workType.get(targetCategory)!;
      const targets = new Map<string, string[]>();
      for (const item of items) {
        const refs = recordRefs(item, field.name);
        if (refs.length) targets.set(item.id, refs);
      }
      // The inverse field on the other type records the same link from its end.
      const inverse = field.inverseFieldId ? models.get(targetType)?.fields.find((candidate) => candidate.name === field.inverseFieldId) : undefined;
      if (inverse) {
        for (const other of liveByType.get(targetType) ?? []) {
          for (const id of recordRefs(other, inverse.name)) {
            if (categoryOf.get(id) !== categoryId) continue;
            const list = targets.get(id) ?? [];
            if (!list.includes(other.id)) list.push(other.id);
            targets.set(id, list);
          }
        }
      }
      const pair = inverse ? [`${type}.${field.name}`, `${targetType}.${inverse.name}`].sort() : [`${type}.${field.name}`];
      calcs.push(makeLine(categoryId, items, {
        key: field.name,
        verb: FIELD_VERBS[`${type}.${field.name}`] ?? KEY_VERBS[field.relationshipTypeKey ?? ''] ?? humanize(field.name),
        targetId: targetCategory,
        targets,
        via: `the ${field.name} field${inverse ? ` (and ${inverse.name} on ${models.get(targetType)?.displayNamePlural?.toLowerCase() ?? targetType})` : ''}`,
        linkKey: `field:${pair.join('|')}`,
        owner: !inverse || ownsInverse(type, field, targetType, inverse),
      }));
    }
    if (categoryId === 'areas' && wantsCapabilityAreas) calcs.push(makeLine(categoryId, items, opportunityLine('capabilities', 'match', 'capabilities', OPP_CAPABILITY_AREAS)));
    if ((categoryId === 'customers' || categoryId === 'people') && wantsPersonas) calcs.push(makeLine(categoryId, items, opportunityLine('personas', 'fit', 'personas', OPP_PERSONA)));
    const members = items.slice().sort((a, b) => Number(workOpen(model, b)) - Number(workOpen(model, a))
      || String(b.system?.updatedAt ?? '').localeCompare(String(a.system?.updatedAt ?? '')) || byTitle(a, b));
    const countLabel = closable && open.length !== items.length ? 'open' : null;
    drafts.push({
      copy: { ...copy, role: countLabel ? `${formatCount(items.length)} in all, ${formatCount(open.length)} open` : copy.role },
      members, count: countLabel ? open.length : items.length, countLabel, us: false, ghost: false, calcs,
      example: statusBreakdown(model, countLabel ? open : items) || members.slice(0, 3).map(ontologyRecordTitle).join('; '),
      note: null,
    });
  }
  if (wantsPersonas) {
    const names = ['customers', 'people'].filter((id) => workType.has(id)).map((id) => {
      const draft = drafts.find((entry) => entry.copy.id === id)!;
      return `${formatCount(draft.members.length)} ${draft.members.length === 1 ? draft.copy.singular : draft.copy.name.toLowerCase()}`;
    });
    drafts.push({
      copy: PERSONA_COPY, members: [], count: 0, countLabel: 'not tracked', us: false, ghost: true, calcs: [],
      example: `You know ${names.join(' and ')}, but not what kind of buyer they are.`,
      note: null,
    });
  }

  const nameOf = new Map(drafts.map((draft) => [draft.copy.id, draft.copy.name]));
  const categoryName = (id: string) => nameOf.get(id) ?? id;
  // Lines to categories this room does not have (a technology line with no us) say nothing.
  for (const draft of drafts) {
    draft.calcs = draft.calcs.filter((calc) => !calc.line.targetId || nameOf.has(calc.line.targetId));
  }

  // -- Gaps --------------------------------------------------------------------
  const gaps: Array<DomainGap<T>> = [];
  const gapFor = (draft: Draft<T>, calc: LineCalc): DomainGap<T> | null => {
    const { line } = calc;
    if (!calc.owner || line.state === 'untracked' || line.missingIds.length === 0) return null;
    const missing = line.missingIds.map((id) => graph.byId.get(id)!).filter(Boolean);
    const noun = (count: number) => (count === 1 ? draft.copy.singular : draft.copy.name.toLowerCase());
    const categoryIds = [draft.copy.id, ...(line.targetId ? [line.targetId] : [])];
    if (line.missing) {
      const count = missing.length;
      const title = count / line.total > 0.5 && count !== line.total
        ? `${count} of ${line.total} ${noun(line.total)} ${line.missing}`
        : `${count} ${noun(count)} ${count === 1 ? singularVerb(line.missing) : line.missing}`;
      return withGap({ id: `line:${line.id}`, check: 'domain-line', title, detail: nameList(missing), count, items: missing }, 'gap', categoryIds);
    }
    // Links between work trackers: only worth fixing once they are rarely recorded.
    // A knowledge line with no `missing` phrase is context, not a gap.
    if (!workType.has(draft.copy.id) || line.total < 3 || line.rate >= SPARSE_FILL_RATE || !line.targetId) return null;
    const target = categoryName(line.targetId).toLowerCase();
    const source = draft.copy.name.toLowerCase();
    const title = line.have === 0 ? `Nobody records which ${target} ${source} ${line.verb}` : `Few ${source} say which ${target} they ${line.verb}`;
    const detail = line.have === 0
      ? `The link exists on ${source} but is used 0 times out of ${formatCount(line.total)}.`
      : `${formatCount(line.have)} of ${formatCount(line.total)} do.`;
    return withGap({ id: `line:${line.id}`, check: 'domain-line', title, detail, count: missing.length, items: missing }, 'gap', categoryIds);
  };
  for (const draft of drafts) {
    for (const calc of draft.calcs) {
      const gap = gapFor(draft, calc);
      if (gap) {
        calc.line.gapId = gap.id;
        gaps.push(gap);
      }
    }
  }

  if (knowledge) {
    const stale = facts.filter((fact) => fact.state === 'stale');
    if (stale.length) {
      const byPredicate = new Map<string, number>();
      for (const fact of stale) byPredicate.set(fact.predicate, (byPredicate.get(fact.predicate) ?? 0) + 1);
      const parts = [...byPredicate.entries()].sort((a, b) => b[1] - a[1]).map(([predicate, count]) => {
        const [one, many] = FACT_NOUNS[predicate] ?? [humanize(predicate), `${humanize(predicate)} facts`];
        return plural(count, one, many);
      });
      const subjects = [...new Map(stale.map((fact) => [fact.subject.id, fact.subject])).values()];
      gaps.push(withGap({
        id: 'stale-facts', check: 'stale-facts',
        title: `${plural(stale.length, 'fact is', 'facts are')} more than ${STALE_FACT_DAYS} days old`,
        detail: `${parts.join(', ')}.`,
        count: stale.length, items: subjects,
      }, 'gap', [...new Set(subjects.map((subject) => categoryOf.get(subject.id)).filter((id): id is string => Boolean(id)))]));
    }
    const duplicates = findDuplicateGroups(graph);
    if (duplicates.length) {
      gaps.push(withGap({
        id: 'duplicates', check: 'duplicates',
        title: `${plural(duplicates.length, 'thing is', 'things are')} recorded twice`,
        detail: `${duplicates.slice(0, 3).map((group) => group.map(ontologyRecordTitle).join(' = ')).join('; ')}${duplicates.length > 3 ? `; and ${duplicates.length - 3} more` : ''}.`,
        count: duplicates.length, items: duplicates.flat(), groups: duplicates,
      }, 'gap', ['competitors']));
    }
    for (const kind of [...CATCH_ALL_KINDS, 'other']) {
      const pages = leftovers.get(kind);
      if (!pages?.length) continue;
      gaps.push(withGap({
        id: `catch-all-kind:${kind}`, check: 'catch-all-kind',
        title: `${plural(pages.length, 'knowledge page has', 'knowledge pages have')} no real category`,
        detail: kind === 'other' ? `They do not say what they are: ${nameList(pages.sort(byTitle))}` : `Filed as ${kind}, which says nothing about what they are: ${nameList(pages.sort(byTitle))}`,
        count: pages.length, items: pages,
      }, 'gap', []));
    }
  }
  if (wantsCompetitorCapabilities) {
    const competitors = knowledgeMembers.get('competitors') ?? [];
    gaps.push(withGap({
      id: OPP_COMPETITOR_CAPABILITIES, check: 'opportunity',
      title: 'No record of which competitors have which capabilities',
      detail: `${plural(competitors.length, 'competitor')} and ${plural(knowledgeMembers.get('capabilities')?.length ?? 0, 'capability', 'capabilities')}, but overlap is only written as prose.`,
      count: competitors.length, items: competitors,
    }, 'opportunity', ['competitors', 'capabilities']));
  }
  if (wantsCapabilityAreas) {
    const capabilities = knowledgeMembers.get('capabilities') ?? [];
    gaps.push(withGap({
      id: OPP_CAPABILITY_AREAS, check: 'opportunity',
      title: "Capabilities and product areas aren't linked",
      detail: `${plural(capabilities.length, 'wiki capability', 'wiki capabilities')} and ${plural(liveByType.get(areaType!)?.length ?? 0, 'product area')} describe the same product. Bugs and features never reach the wiki.`,
      count: capabilities.length, items: capabilities,
    }, 'opportunity', ['capabilities', 'areas']));
  }
  if (wantsPersonas) {
    const persona = drafts.find((draft) => draft.ghost)!;
    gaps.push(withGap({
      id: OPP_PERSONA, check: 'opportunity',
      title: "You don't track personas yet",
      detail: persona.example,
      count: 0, items: [],
    }, 'opportunity', ['personas', 'customers', 'people']));
  }
  // A gap sits with the category it is about (its first), market first, work last.
  const groupRank = (gap: DomainGap<T>) => {
    const group = drafts.find((draft) => draft.copy.id === gap.categoryIds[0])?.copy.group;
    return group ? DOMAIN_GROUP_ORDER.indexOf(group) : DOMAIN_GROUP_ORDER.length;
  };
  gaps.sort((a, b) => groupRank(a) - groupRank(b) || Number(a.tone === 'opportunity') - Number(b.tone === 'opportunity') || b.count - a.count);

  // -- Edges for the concept map ----------------------------------------------
  const edges: DomainEdge[] = [];
  const seen = new Set<string>();
  for (const draft of drafts) {
    for (const calc of draft.calcs) {
      const { line } = calc;
      if (!line.targetId || !calc.owner) continue;
      const pairKey = `${calc.linkKey}|${[draft.copy.id, line.targetId].sort().join('|')}`;
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);
      const opportunity = calc.linkKey.startsWith('opp:');
      edges.push({
        id: line.id,
        from: draft.copy.id,
        to: line.targetId,
        verb: line.verb,
        links: line.links,
        have: line.have,
        total: line.total,
        state: opportunity ? 'missing' : line.rate < SPARSE_FILL_RATE && !draft.us ? 'weak' : 'recorded',
        gapId: opportunity ? calc.linkKey.slice(4) : line.gapId,
      });
    }
  }
  // Opportunities whose line only one end carries (personas fit customers and people) still draw both.
  for (const draft of drafts) {
    for (const calc of draft.calcs) {
      if (!calc.linkKey.startsWith('opp:') || !calc.line.targetId) continue;
      const pairKey = `${calc.linkKey}|${[draft.copy.id, calc.line.targetId].sort().join('|')}`;
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);
      edges.push({ id: calc.line.id, from: draft.copy.id, to: calc.line.targetId, verb: calc.line.verb, links: 0, have: 0, total: calc.line.total, state: 'missing', gapId: calc.linkKey.slice(4) });
    }
  }

  // -- Assemble --------------------------------------------------------------
  const context: DomainContext<T> = {
    graph, models, summaries, us, facts, markets: marketTree, categoryOf, categoryName, workType, now: input.now,
  };
  const categories: Array<DomainCategory<T>> = drafts.map((draft) => {
    const detail = buildCategoryDetail(context, draft.copy.id, draft.members, draft.calcs);
    return {
      id: draft.copy.id,
      name: draft.copy.name,
      singular: draft.copy.singular,
      group: draft.copy.group,
      role: fill(draft.copy.role, usName),
      blurb: fill(draft.copy.blurb, usName),
      count: draft.count,
      countLabel: draft.countLabel,
      total: draft.members.length,
      us: draft.us,
      ghost: draft.ghost,
      members: draft.members,
      example: draft.example,
      lines: draft.calcs.map((calc) => calc.line),
      gapIds: gaps.filter((gap) => gap.categoryIds.includes(draft.copy.id)).map((gap) => gap.id),
      note: draft.note,
      schema: detail.schema,
      table: detail.table,
    };
  });

  const groups = DOMAIN_GROUP_ORDER.map((id) => ({
    id,
    label: GROUP_COPY[id].label,
    question: GROUP_COPY[id].question(usName),
    categoryIds: categories.filter((category) => category.group === id).map((category) => category.id),
  })).filter((group) => group.categoryIds.length > 0);

  const also: DomainModel<T>['also'] = [];
  for (const [kind, pages] of leftovers) {
    if (CATCH_ALL_KINDS.has(kind) || kind === 'other') continue;
    also.push({ id: `kind:${kind}`, name: kindChipName(kind, models.get(ENTITY_TYPE)), count: pages.length });
  }
  for (const [type, items] of liveByType) {
    if (HIDDEN_TYPES.has(type) || WORK_COPY[type]) continue;
    const model = models.get(type);
    also.push({ id: `type:${type}`, name: TYPE_CHIP_NAMES[type] ?? model?.displayNamePlural ?? model?.displayName ?? type, count: items.length });
  }
  also.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  let lastChange: string | null = null;
  for (const record of graph.live) {
    const stamp = record.system?.updatedAt ?? record.system?.createdAt;
    if (stamp && (!lastChange || stamp > lastChange)) lastChange = stamp;
  }

  return {
    us,
    categories,
    groups,
    also,
    summary: buildSummary(categories, usName),
    meta: {
      pages: graph.entities.filter((entity) => !STRUCTURE_KINDS.has(entityKind(entity))).length,
      statements: graph.claims.length,
      types: liveByType.size,
      lastChange,
    },
    gaps,
    edges,
  };
}

function withGap<T extends OntologyRecordLike>(draft: Omit<HealthItem<T>, 'itemIds' | 'groupIds'>, tone: DomainGapTone, categoryIds: string[]): DomainGap<T> {
  return { ...withHealthIds(draft), tone, categoryIds };
}

function relationshipField(field: FieldDefinition): boolean {
  return field.type === 'relationship' || field.type === 'reference';
}

function targetsOf(field: FieldDefinition): string[] {
  return Array.isArray(field.targetTrackerTypes) ? field.targetTrackerTypes : [];
}

/**
 * Which end of an inverse pair owns it: the child (`child-of`, `contributed-by`)
 * rather than the parent that collects, then the single-valued end, then by name.
 */
function ownsInverse(type: string, field: FieldDefinition, targetType: string, inverse: FieldDefinition): boolean {
  const collects = (candidate: FieldDefinition) => candidate.relationshipTypeKey === 'parent-of' || candidate.relationshipTypeKey === 'contributes-to';
  if (collects(field) !== collects(inverse)) return !collects(field);
  if (Boolean(field.multiValue) !== Boolean(inverse.multiValue)) return !field.multiValue;
  return `${type}.${field.name}` < `${targetType}.${inverse.name}`;
}

function kindChipName(kind: string, entity: TrackerDataModel | undefined): string {
  if (kind === 'product') return 'Other products';
  if (kind === 'person') return 'Named people';
  const label = entity?.fields.find((field) => field.name === 'kind')?.options?.find((option) => option.value === kind)?.label ?? capitalize(humanize(kind));
  return /s$/.test(label) ? label : `${label}s`;
}

export { formatCount, nameList, singularVerb } from './ontologyDomainVocabulary';
export { suggestStructureRequest } from './ontologyDomainSummary';
