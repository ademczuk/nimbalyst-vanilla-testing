/**
 * One category's detail page: the members table and the "Schema: how this is
 * stored" disclosure. Split from `ontologyDomain.ts`, which decides what the
 * categories and their relationship lines are; this only lays them out.
 */
import type { DomainContext, DomainSchema, LineCalc, MemberCell, MemberRow, MemberTable, SchemaRow, StoredPart } from './ontologyDomain';
import { singularVerb } from './ontologyDomainVocabulary';
import { claimPredicate, claimQualifiers, DEPRECATED_ENTITY_FIELDS, ENTITY_TYPE, entityKind, type FactValue, type MarketNode } from './ontologyKnowledge';
import { isEmptyFieldValue, ontologyFieldValue, ontologyRecordTitle, recordRefs, type OntologyRecordLike } from './ontologyRecords';

const THREAT_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
const COMPETES_QUALIFIERS = ['market', 'threat', 'overlap', 'difference', 'reviewedAt'];
const OTHER_ORG_FACTS = ['valuation', 'funding-total', 'headcount', 'last-round', 'founded', 'hq'];
const KNOWLEDGE_KINDS: Record<string, string[]> = {
  markets: ['market'],
  organizations: ['organization'],
  capabilities: ['capability'],
  technologies: ['technology', 'protocol'],
};
const MAX_SCHEMA_ROWS = 10;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A fact's as-of date to its precision: "Mar 2025", "2025", "Mar 4, 2025". */
export function formatAsOf(asOf: string | null, precision: string): string {
  const match = asOf ? /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/.exec(asOf) : null;
  if (!match) return 'undated';
  const month = match[2] ? MONTHS[Number(match[2]) - 1] : undefined;
  if (precision === 'year' || !month) return match[1]!;
  if (precision === 'month' || !match[3]) return `${month} ${match[1]}`;
  return `${month} ${Number(match[3])}, ${match[1]}`;
}

function capitalize(value: string): string {
  return value ? value[0]!.toUpperCase() + value.slice(1) : value;
}

function titles(context: DomainContext, ids: readonly string[] | undefined, limit = 3): string {
  if (!ids?.length) return '';
  const names = ids.map((id) => {
    const record = context.graph.allById.get(id);
    return record ? ontologyRecordTitle(record) : id;
  });
  return names.length > limit ? `${names.slice(0, limit).join(', ')} +${names.length - limit}` : names.join(', ');
}

function lineCalc(calcs: readonly LineCalc[], key: string): LineCalc | undefined {
  return calcs.find((calc) => calc.line.id.endsWith(`:${key}`));
}

function threatOf(context: DomainContext, id: string): string | null {
  let best: string | null = null;
  const claims = [...(context.graph.claimsBySubject.get(id) ?? []), ...(context.graph.claimsByObject.get(id) ?? [])];
  for (const claim of claims) {
    if (claimPredicate(claim) !== 'competes-with') continue;
    const threat = claimQualifiers(claim).threat;
    if (typeof threat === 'string' && (THREAT_RANK[threat] ?? 0) > (THREAT_RANK[best ?? ''] ?? 0)) best = threat;
  }
  return best;
}

function factCell(fact: FactValue | undefined): MemberCell {
  if (!fact) return { text: 'unknown', tone: 'warn' };
  const value = ontologyFieldValue(fact.claim, 'valueText');
  const text = `${typeof value === 'string' && value ? value : fact.predicate} · ${formatAsOf(fact.asOf, fact.precision)}`;
  return fact.state === 'current' ? { text } : { text: `${text} (${fact.state})`, tone: 'warn' };
}

function linkedCell(context: DomainContext, calc: LineCalc | undefined, id: string, missing: MemberCell): MemberCell {
  const text = titles(context, calc?.targets.get(id));
  return text ? { text } : missing;
}

export function buildCategoryDetail<T extends OntologyRecordLike>(
  context: DomainContext<T>,
  categoryId: string,
  members: readonly T[],
  calcs: readonly LineCalc[],
): { table: MemberTable; schema: DomainSchema | null } {
  if (categoryId === 'personas') return { table: { columns: [], rows: [] }, schema: null };
  const unknown: MemberCell = { text: 'unknown', tone: 'warn' };
  const none: MemberCell = { text: '—', tone: 'faint' };
  let table: MemberTable;

  if (categoryId === 'us') {
    const us = members[0]!;
    table = {
      columns: ['Recorded', 'What'],
      rows: calcs.map((calc) => ({
        id: calc.line.id,
        cells: [{ text: capitalize(singularVerb(calc.line.verb)) }, linkedCell(context, calc, us.id, { text: 'not recorded', tone: 'warn' })],
      })),
    };
  } else if (categoryId === 'competitors') {
    const market = lineCalc(calcs, 'in-market');
    const maker = lineCalc(calcs, 'made-by');
    table = {
      columns: ['Competitor', 'Market', 'Threat', 'Made by'],
      rows: members.map((member) => {
        const threat = threatOf(context, member.id);
        return {
          id: member.id,
          cells: [
            { text: ontologyRecordTitle(member) },
            linkedCell(context, market, member.id, unknown),
            threat ? { text: threat, threat } : { text: 'not rated', tone: 'faint' },
            linkedCell(context, maker, member.id, unknown),
          ],
        };
      }),
    };
  } else if (categoryId === 'markets') {
    const nodes = new Map<string, MarketNode<T>>();
    const walk = (node: MarketNode<T>) => { nodes.set(node.record.id, node); node.children.forEach(walk); };
    context.markets.forEach(walk);
    const membersUnder = (node: MarketNode<T> | undefined): string[] => node ? [...node.direct.map((page) => page.id), ...node.children.flatMap(membersUnder)] : [];
    table = {
      columns: ['Market', 'Part of', 'Products', 'Highest threat'],
      rows: members.map((member) => {
        const node = nodes.get(member.id);
        const parent = context.graph.byId.get(recordRefs(member, 'parent')[0] ?? '');
        let best: string | null = null;
        for (const id of membersUnder(node)) {
          const threat = threatOf(context, id);
          if (threat && (THREAT_RANK[threat] ?? 0) > (THREAT_RANK[best ?? ''] ?? 0)) best = threat;
        }
        return {
          id: member.id,
          cells: [
            { text: ontologyRecordTitle(member) },
            parent && entityKind(parent) === 'market' ? { text: ontologyRecordTitle(parent) } : none,
            { text: String(node?.total ?? 0), tone: node?.total ? undefined : 'warn' },
            best ? { text: best, threat: best } : none,
          ],
        };
      }),
    };
  } else if (categoryId === 'organizations') {
    const factsOf = new Map<string, FactValue[]>();
    for (const fact of context.facts) {
      const list = factsOf.get(fact.subject.id) ?? [];
      list.push(fact);
      factsOf.set(fact.subject.id, list);
    }
    table = {
      columns: ['Company', 'Makes', 'Revenue', 'Other facts'],
      rows: members.map((member) => {
        const facts = factsOf.get(member.id) ?? [];
        const makes = (context.graph.claimsByObject.get(member.id) ?? []).filter((claim) => claimPredicate(claim) === 'made-by').flatMap((claim) => recordRefs(claim, 'subject'));
        const others = facts.filter((fact) => OTHER_ORG_FACTS.includes(fact.predicate)).map((fact) => {
          const value = ontologyFieldValue(fact.claim, 'valueText');
          return typeof value === 'string' && value ? value : fact.predicate;
        });
        return {
          id: member.id,
          cells: [
            { text: ontologyRecordTitle(member) },
            makes.length ? { text: titles(context, makes, 2) } : none,
            factCell(facts.find((fact) => fact.predicate === 'annual-revenue')),
            others.length ? { text: others.join(' · ') } : none,
          ],
        };
      }),
    };
  } else if (context.workType.has(categoryId)) {
    const type = context.workType.get(categoryId)!;
    const model = context.models.get(type);
    const statusField = model?.roles?.workflowStatus ?? 'status';
    const options = model?.fields.find((field) => field.name === statusField)?.options ?? [];
    const linked = calcs.filter((calc) => calc.line.targetId && calc.line.state !== 'untracked');
    table = {
      columns: ['Name', 'Status', ...linked.map((calc) => capitalize(context.categoryName(calc.line.targetId!)))],
      rows: members.map((member) => {
        const status = ontologyFieldValue(member, statusField);
        const label = options.find((option) => option.value === status)?.label ?? (typeof status === 'string' ? status : '');
        return {
          id: member.id,
          cells: [
            { text: ontologyRecordTitle(member) },
            label ? { text: label } : none,
            ...linked.map((calc) => linkedCell(context, calc, member.id, none)),
          ],
        };
      }),
    };
  } else {
    table = {
      columns: ['Name', 'Recorded as'],
      rows: members.map((member): MemberRow => {
        const parts = calcs
          .filter((calc) => calc.targets.get(member.id)?.length)
          .map((calc) => `${calc.line.verb.replace(/^are /, '')} ${titles(context, calc.targets.get(member.id), 2)}`);
        return { id: member.id, cells: [{ text: ontologyRecordTitle(member) }, parts.length ? { text: parts.join(' · ') } : { text: 'no statements', tone: 'warn' }] };
      }),
    };
  }

  return { table, schema: buildSchema(context, categoryId, members, calcs) };
}

function code(text: string): StoredPart {
  return { text, code: true };
}

function entityRows<T extends OntologyRecordLike>(context: DomainContext<T>, kinds: readonly string[], members: readonly T[]): SchemaRow[] {
  const entity = context.summaries.get(ENTITY_TYPE);
  const names = new Set<string>();
  for (const kind of entity?.kinds ?? []) {
    if (kinds.includes(kind.kind)) kind.fields.forEach((field) => names.add(field.name));
  }
  return [...names].map((name) => ({
    label: name,
    filled: members.filter((member) => !isEmptyFieldValue(ontologyFieldValue(member, name))).length,
    total: members.length,
    retired: DEPRECATED_ENTITY_FIELDS.has(name),
  })).sort((a, b) => Number(a.retired) - Number(b.retired) || (b.filled ?? 0) - (a.filled ?? 0) || a.label.localeCompare(b.label));
}

function statementRows(calcs: readonly LineCalc[]): SchemaRow[] {
  return calcs
    .filter((calc) => calc.linkKey.startsWith('claim:') || calc.linkKey.startsWith('fact:'))
    .map((calc) => ({ label: calc.line.via.replace(/ statements$/, ' statement').replace(/ facts$/, ' fact'), filled: calc.line.have, total: calc.line.total, retired: false }));
}

function buildSchema<T extends OntologyRecordLike>(context: DomainContext<T>, categoryId: string, members: readonly T[], calcs: readonly LineCalc[]): DomainSchema | null {
  const usName = context.us ? ontologyRecordTitle(context.us) : 'us';
  if (categoryId === 'us') {
    return {
      stored: [{ text: 'A knowledge page, ' }, code(ENTITY_TYPE), { text: ' with kind ' }, code(context.us ? entityKind(context.us) : 'product'), { text: '.' }],
      rows: [...entityRows(context, ['product'], members), ...statementRows(calcs)].slice(0, MAX_SCHEMA_ROWS),
    };
  }
  if (categoryId === 'competitors') {
    const ids = new Set(members.map((member) => member.id));
    const claims = context.graph.claims.filter((claim) => claimPredicate(claim) === 'competes-with'
      && [...recordRefs(claim, 'subject'), ...recordRefs(claim, 'object')].some((id) => ids.has(id)));
    const qualifierRows = COMPETES_QUALIFIERS.map((name) => ({
      label: `${name} (on statement)`,
      filled: claims.filter((claim) => !isEmptyFieldValue(claimQualifiers(claim)[name])).length,
      total: claims.length,
      retired: false,
    }));
    const retired = [...DEPRECATED_ENTITY_FIELDS].map((name) => ({
      label: `${name} (old page field)`,
      filled: members.filter((member) => !isEmptyFieldValue(ontologyFieldValue(member, name))).length,
      total: members.length,
      retired: true,
    })).filter((row) => row.filled > 0);
    return {
      stored: [
        { text: 'A knowledge page (' }, code(ENTITY_TYPE), { text: ', kind ' }, code('product'),
        { text: ') that is the object of a ' }, code('competes-with'),
        { text: ` statement from ${usName}. The threat, market, overlap, and difference live on that statement.` },
      ],
      rows: [...qualifierRows, ...statementRows(calcs), ...retired].slice(0, MAX_SCHEMA_ROWS),
    };
  }
  const kinds = KNOWLEDGE_KINDS[categoryId];
  if (kinds) {
    const stored: StoredPart[] = [{ text: 'Knowledge pages with kind ' }];
    kinds.forEach((kind, index) => {
      if (index > 0) stored.push({ text: ' or ' });
      stored.push(code(kind));
    });
    stored.push({ text: categoryId === 'markets' ? ', nested by ' : '.' });
    if (categoryId === 'markets') stored.push(code('parent'), { text: '. Products join through ' }, code('in-market'), { text: ' statements.' });
    return { stored, rows: [...statementRows(calcs), ...entityRows(context, kinds, members)].slice(0, MAX_SCHEMA_ROWS) };
  }
  const type = context.workType.get(categoryId);
  if (type) {
    const summary = context.summaries.get(type);
    return {
      stored: [{ text: 'Tracker type ' }, code(type), { text: '.' }],
      rows: (summary?.fields ?? []).slice(0, MAX_SCHEMA_ROWS).map((field) => ({ label: field.name, filled: field.filled, total: summary?.count ?? 0, retired: false })),
    };
  }
  return null;
}
