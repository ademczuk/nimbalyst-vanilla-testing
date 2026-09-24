// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { createTrackerReferenceResolver } from '../trackerReferenceResolver';
import { fakeDataSource, fakeSchema, item } from './referenceFixtures';

const gateway = item({ id: 'ent-gateway', issueKey: 'KB-1', type: 'entity', title: 'API gateway', status: 'active' });
const auth = item({ id: 'ent-auth', issueKey: 'KB-2', type: 'entity', title: 'Auth service', status: 'active' });

describe('createTrackerReferenceResolver', () => {
  it('resolves keys and ids, tells loading from missing, and keeps unrelated reads stable', async () => {
    const fake = fakeDataSource('connecting');
    const resolver = createTrackerReferenceResolver(fake.source, { schema: fakeSchema() });

    expect(resolver.resolve('KB-1').state).toBe('loading');
    await fake.release([gateway, auth]);

    // Snapshot landed but the room has not finished syncing: absence is not evidence.
    expect(resolver.resolve('KB-99').state).toBe('loading');
    fake.emit({ type: 'status', sync: { workspacePath: 'ws', status: 'connected', projectId: 'p' } });
    expect(resolver.resolve('KB-99').state).toBe('missing');

    const byKey = resolver.resolve('kb-1');
    const byId = resolver.resolve('ent-gateway');
    expect(byKey.state === 'resolved' && byKey.item).toBe(gateway);
    expect(byId.state === 'resolved' && byId.item).toBe(gateway);
    expect(byKey.state === 'resolved' && byKey.typeInfo).toMatchObject({ displayName: 'Entity', color: '#3b82f6' });
    expect(byKey.state === 'resolved' && byKey.status).toMatchObject({ label: 'Active', category: 'started' });

    let notified = 0;
    resolver.subscribe(() => { notified += 1; });
    fake.emit({ type: 'items-upserted', items: [{ ...auth, title: 'Auth service v2' }] });
    expect(notified).toBe(1);
    expect(resolver.resolve('ent-gateway')).toBe(byId);

    fake.emit({ type: 'items-upserted', items: [{ ...gateway, title: 'Edge gateway' }] });
    const updated = resolver.resolve('ent-gateway');
    expect(updated).not.toBe(byId);
    expect(updated.state === 'resolved' && updated.item.title).toBe('Edge gateway');

    fake.emit({ type: 'items-removed', itemIds: ['ent-gateway'] });
    expect(resolver.resolve('KB-1').state).toBe('missing');
    resolver.dispose();
  });

  it('recovers from a rejected first snapshot instead of loading forever', async () => {
    const fake = fakeDataSource('connecting', { rejectFirstSnapshot: true });
    const resolver = createTrackerReferenceResolver(fake.source, { schema: fakeSchema() });
    await fake.release([]);
    expect(resolver.resolve('KB-1').state).toBe('loading');

    // An authoritative replacement initializes the resolver on its own.
    fake.emit({ type: 'items-replaced', items: [gateway] });
    fake.emit({ type: 'status', sync: { workspacePath: 'ws', status: 'connected', projectId: 'p' } });
    const resolved = resolver.resolve('KB-1');
    expect(resolved.state === 'resolved' && resolved.item).toBe(gateway);
    resolver.dispose();

    // Without a replacement, reconnecting retries the snapshot.
    const retry = fakeDataSource('connecting', { rejectFirstSnapshot: true });
    const retrying = createTrackerReferenceResolver(retry.source, { schema: fakeSchema() });
    await retry.release([gateway]);
    retry.emit({ type: 'items-upserted', items: [auth] });
    retry.emit({ type: 'status', sync: { workspacePath: 'ws', status: 'connected', projectId: 'p' } });
    await Promise.resolve();
    await Promise.resolve();
    expect(retry.snapshotCalls).toBe(2);
    expect(retrying.resolve('KB-1').state).toBe('resolved');
    // A change that arrived while the snapshot was failing is replayed, not lost.
    expect(retrying.resolve('KB-2').state).toBe('resolved');
    retrying.dispose();
  });

  it('groups statements by predicate and finds backlinks in either storage shape', async () => {
    const fake = fakeDataSource();
    const resolver = createTrackerReferenceResolver(fake.source, { schema: fakeSchema() });
    const claims = [
      item({
        id: 'c-dep', type: 'claim', title: 'Gateway depends on auth',
        customFields: {
          subject: { itemId: 'ent-gateway' },
          predicate: 'depends-on-service',
          object: [{ itemId: 'ent-auth' }],
          basis: 'observed',
          citations: [{ url: 'a' }, { url: 'b' }],
        },
      }),
      item({
        id: 'c-limit', type: 'claim', title: 'Gateway rate limit',
        customFields: { subject: [{ itemId: 'ent-gateway' }], predicate: 'rate-limit', valueText: '100 rps' },
      }),
      // Legacy top-level storage still counts.
      { ...item({ id: 'c-legacy', type: 'claim', title: 'Unclassified' }), subject: { itemId: 'ent-gateway' } } as never,
      item({ id: 'c-other', type: 'claim', title: 'About auth', customFields: { subject: { itemId: 'ent-auth' } } }),
    ];
    const question = item({
      id: 'q-1', type: 'question', title: 'Who owns the gateway?', status: 'open',
      customFields: { subjects: [{ itemId: 'ent-gateway' }, { itemId: 'ent-auth' }] },
    });
    await fake.release([gateway, auth, ...claims, question]);

    const groups = resolver.statementsAbout('ent-gateway');
    expect(groups.map((group) => [group.label, group.statements.map((s) => s.claim.id)])).toEqual([
      ['Depends on', ['c-dep']],
      ['Rate limit', ['c-limit']],
      ['Unspecified', ['c-legacy']],
    ]);
    expect(groups[0].statements[0]).toMatchObject({
      objectItemId: 'ent-auth', basisLabel: 'Observed', citationCount: 2,
    });
    expect(groups[1].statements[0]).toMatchObject({ objectItemId: null, valueText: '100 rps' });
    expect(resolver.statementsAbout('ent-gateway')).toBe(groups);

    expect(resolver.backlinks('ent-auth').map((link) => [link.source.id, link.fieldName, link.relationshipTypeKey])).toEqual([
      ['c-other', 'subject', 'about'],
      ['c-dep', 'object', 'states'],
      ['q-1', 'subjects', 'concerns'],
    ]);
    expect(resolver.backlinks('ent-gateway').map((link) => link.source.id)).toEqual([
      'c-dep', 'c-limit', 'c-legacy', 'q-1',
    ]);

    // An unrelated edit leaves the statement list identical by reference.
    fake.emit({ type: 'items-upserted', items: [{ ...auth, title: 'Identity' }] });
    expect(resolver.statementsAbout('ent-gateway')).toBe(groups);
    resolver.dispose();
  });

  it('searches the room by issue key and title for the insert typeahead, honoring a type scope', async () => {
    const fake = fakeDataSource('connected');
    const resolver = createTrackerReferenceResolver(fake.source, { schema: fakeSchema() });
    const claim = item({ id: 'c1', issueKey: 'KB-3', issueNumber: 3, type: 'claim', title: 'Gateway retries twice' });
    const archived = item({ id: 'old', issueKey: 'KB-4', issueNumber: 4, type: 'entity', title: 'Old gateway', archived: true });
    await fake.release([
      { ...gateway, issueNumber: 1 },
      { ...auth, issueNumber: 2, description: 'Issues gateway tokens' },
      claim,
      archived,
    ]);

    // Newest first with no query; archived items never offered.
    expect(resolver.search!(null).options.map((o) => o.referenceKey)).toEqual(['KB-3', 'KB-2', 'KB-1']);
    // Title prefix beats title substring beats description match.
    expect(resolver.search!('gateway').options.map((o) => o.referenceKey)).toEqual(['KB-3', 'KB-1', 'KB-2']);
    expect(resolver.search!('kb-2').options[0]).toMatchObject({ referenceKey: 'KB-2', title: 'Auth service', type: 'entity' });
    const scoped = resolver.search!('claim:gate');
    expect(scoped).toMatchObject({ typeFilter: 'claim', searchQuery: 'gate' });
    expect(scoped.options.map((o) => o.referenceKey)).toEqual(['KB-3']);
    resolver.dispose();
  });
});
