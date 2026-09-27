import type { OntologyRecordLike } from '../ontologyRecords';

/** 2026-09-24, the day the fixture's facts are judged against. */
export const NOW = Date.UTC(2026, 8, 24);

export function rec(id: string, primaryType: string, fields: Record<string, unknown>, archived = false): OntologyRecordLike {
  return { id, primaryType, archived, fields: { title: id, ...fields }, system: { createdAt: '2026-09-01T00:00:00Z' } };
}

export const ref = (itemId: string) => ({ itemId });

export const claim = (id: string, subject: string, predicate: string, object?: string, extra: Record<string, unknown> = {}) =>
  rec(id, 'claim', { subject: ref(subject), predicate, ...(object ? { object: ref(object) } : {}), status: 'asserted', ...extra });

/**
 * A small knowledge graph shaped like contract r2, with one of each problem:
 * a catch-all kind, a sparse and a deprecated field, a live competitor item
 * repeating a page (and an archived one that no longer counts), products with
 * no market or maker, and stale, current and undated facts at day and month
 * precision.
 */
export const knowledgeFixture = (): OntologyRecordLike[] => [
  rec('Markets', 'entity', { kind: 'area' }),
  rec('AI software development', 'entity', { kind: 'market', parent: ref('Markets') }),
  rec('AI IDE', 'entity', { kind: 'market', parent: ref('AI software development') }),
  rec('Team wiki', 'entity', { kind: 'market', parent: ref('Markets') }),
  rec('Nimbalyst', 'entity', { kind: 'product', summary: 'us', website: 'nimbalyst.com' }),
  rec('Cursor', 'entity', { kind: 'product', summary: 'ide', threat: 'high' }),
  rec('Zed', 'entity', { kind: 'product', summary: 'editor' }),
  rec('Notion', 'entity', { kind: 'product', summary: 'docs', aliases: ['Notion AI'] }),
  rec('Anysphere', 'entity', { kind: 'organization' }),
  rec('Pricing', 'entity', { kind: 'concept' }),
  rec('Blog strategy', 'entity', { kind: 'concept', summary: 'x' }),
  rec('Gone', 'entity', { kind: 'concept' }, true),
  rec('NIM-1374', 'competitor', { title: 'notion ai' }),
  rec('NIM-1350', 'competitor', { title: 'Cursor' }, true),
  claim('c1', 'Cursor', 'in-market', 'AI IDE'),
  claim('c2', 'Zed', 'in-market', 'AI IDE'),
  claim('c3', 'Cursor', 'made-by', 'Anysphere'),
  claim('c4', 'Nimbalyst', 'competes-with', 'Cursor', { qualifiers: { threat: 'high' } }),
  claim('c5', 'Anysphere', 'annual-revenue', undefined, { valueText: '$500M ARR', qualifiers: { asOf: '2026-03-01', amount: 500000000, unit: 'USD' } }),
  claim('c6', 'Anysphere', 'annual-revenue', undefined, { valueText: '$100M ARR', qualifiers: { asOf: '2025-06-01' } }),
  // Month precision: stale 90 days after Jun 30, so still current on Sep 24.
  claim('c7', 'Anysphere', 'headcount', undefined, { valueText: '300', qualifiers: { asOf: '2026-06-01', asOfPrecision: 'month' } }),
  claim('c8', 'Zed', 'pricing', undefined, { valueText: 'free' }),
  // Lifecycle lives in valueText; migrated facts cite the archived competitor item.
  claim('c9', 'Cursor', 'lifecycle', undefined, { valueText: 'active', qualifiers: { asOf: '2025-03-01', asOfPrecision: 'month' }, citations: [{ itemId: 'NIM-1350', issueKey: 'NIM-1350' }] }),
  claim('c10', 'Notion', 'mentioned-in', 'NIM-1350'),
  claim('c12', 'Nimbalyst', 'pricing', undefined, { valueText: 'free during beta', qualifiers: { asOf: '2026-09-01' } }),
];

/**
 * The knowledge fixture plus the domain around it: a second competitor with no
 * maker or threat, a capability and a technology, and work trackers whose links
 * are recorded from either end of an inverse pair (bug.area / area.bugs).
 */
export const domainFixture = (): OntologyRecordLike[] => [
  ...knowledgeFixture(),
  rec('Orchestration', 'entity', { kind: 'capability' }),
  rec('Yjs', 'entity', { kind: 'technology' }),
  rec('IndexedDB', 'entity', { kind: 'technology' }),
  claim('d1', 'Nimbalyst', 'competes-with', 'Zed'),
  claim('d2', 'Orchestration', 'component-of', 'Nimbalyst'),
  claim('d3', 'Orchestration', 'requires', 'Yjs'),
  // A withdrawn statement records nothing.
  claim('d4', 'Zed', 'made-by', 'Anysphere', { status: 'withdrawn' }),
  rec('A1', 'feature-module', { title: 'Agent Mode', bugs: [ref('B1')] }),
  rec('A2', 'feature-module', { title: 'Collab Trackers' }),
  rec('B1', 'bug', { status: 'to-do' }),
  rec('B2', 'bug', { status: 'to-do', area: [ref('A2')] }),
  rec('B3', 'bug', { status: 'done' }),
  rec('B4', 'bug', { status: 'to-do' }),
  rec('D1', 'decision', { area: [ref('A1')] }),
  rec('D2', 'decision', {}),
  rec('D3', 'decision', {}),
  rec('D4', 'decision', {}),
  rec('K1', 'customer', { title: 'Autodesk', users: [ref('U1')] }),
  rec('K2', 'customer', { title: 'Medipyxis' }),
  rec('K3', 'customer', { title: 'Bayfillers' }),
  rec('U1', 'user', { title: 'Ada' }),
  rec('U2', 'user', { title: 'Grace', company: ref('K2') }),
  rec('T1', 'task', {}),
];
