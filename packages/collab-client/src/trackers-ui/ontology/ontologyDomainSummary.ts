/**
 * The plain sentence at the top of "What we track", and the request "Ask the
 * agent to suggest improvements" writes. Split from `ontologyDomain.ts`.
 */
import type { DomainCategory, DomainGroupId, DomainModel, SummaryPart } from './ontologyDomain';
import { formatCount } from './ontologyDomainVocabulary';

function countPhrase(category: DomainCategory): string {
  const noun = category.count === 1 ? category.singular : category.name.toLowerCase();
  return `${formatCount(category.count)} ${category.countLabel === 'open' ? 'open ' : ''}${noun}`;
}

function joinParts(items: SummaryPart[][], last = ' and '): SummaryPart[] {
  const out: SummaryPart[] = [];
  items.forEach((item, index) => {
    if (index > 0) out.push({ text: index === items.length - 1 ? last : ', ' });
    out.push(...item);
  });
  return out;
}

/**
 * "Your team tracks 59 competitors across 11 markets and the 42 companies
 * behind them; what Nimbalyst can do, as 19 capabilities on 14 technologies;
 * who uses it, as 168 customers and 317 people; and the work: 345 open bugs,
 * 217 decisions, 72 plans."
 */
export function buildSummary(categories: readonly DomainCategory[], usName: string): SummaryPart[] {
  const shown = categories.filter((category) => !category.us && !category.ghost && category.count > 0);
  const link = (category: DomainCategory): SummaryPart[] => [{ text: countPhrase(category), categoryId: category.id }];
  const inGroup = (group: DomainGroupId) => shown.filter((category) => category.group === group);
  const clauses: SummaryPart[][] = [];

  const market = inGroup('market');
  if (market.length) {
    const competitors = market.find((category) => category.id === 'competitors');
    const markets = market.find((category) => category.id === 'markets');
    const organizations = market.find((category) => category.id === 'organizations');
    if (competitors && markets) {
      const clause = [...link(competitors), { text: ' across ' }, ...link(markets)];
      if (organizations) clause.push({ text: ' and the ' }, ...link(organizations), { text: ' behind them' });
      clauses.push(clause);
    } else {
      clauses.push(joinParts(market.map(link)));
    }
  }
  const product = inGroup('product');
  if (product.length) {
    const capabilities = product.find((category) => category.id === 'capabilities');
    const technologies = product.find((category) => category.id === 'technologies');
    const rest = product.filter((category) => category !== capabilities && category !== technologies);
    const head: SummaryPart[] = capabilities && technologies
      ? [...link(capabilities), { text: ' on ' }, ...link(technologies)]
      : joinParts([capabilities, technologies].filter((category): category is DomainCategory => Boolean(category)).map(link));
    const all = head.length ? [head, ...rest.map(link)] : rest.map(link);
    clauses.push([{ text: `what ${usName} can do, as ` }, ...joinParts(all)]);
  }
  const customers = inGroup('customers');
  if (customers.length) clauses.push([{ text: 'who uses it, as ' }, ...joinParts(customers.map(link))]);
  const work = inGroup('work');
  if (work.length) clauses.push([{ text: 'the work: ' }, ...joinParts(work.map(link), ', ')]);

  if (!clauses.length) return [{ text: 'Your team does not track anything here yet.' }];
  const parts: SummaryPart[] = [{ text: 'Your team tracks ' }];
  clauses.forEach((clause, index) => {
    if (index > 0) parts.push({ text: index === clauses.length - 1 ? '; and ' : '; ' });
    parts.push(...clause);
  });
  parts.push({ text: '.' });
  return parts;
}

/** What "Ask the agent to suggest improvements" writes: every gap, for an agent to rank and draft. */
export function suggestStructureRequest(model: DomainModel): { title: string; request: string; healthCheck: string } {
  return {
    title: 'Suggest structure improvements',
    healthCheck: 'suggest-structure',
    request: [
      'Review what this project tracks and draft the ontology changes with the most effect, one proposal per change.',
      '',
      `Tracked: ${model.categories.filter((category) => !category.ghost).map((category) => `${category.name} (${category.total})`).join(', ')}.`,
      '',
      'Gaps found:',
      ...model.gaps.map((gap) => `- ${gap.title} [${gap.id}]`),
    ].join('\n'),
  };
}

