// @vitest-environment jsdom
/**
 * The inspector is read-only; the only writes it makes go through a proposal.
 * These cover the two a reader cannot check by looking: a gap's Fix writes a
 * proposal request through the writer (and then points at it instead of
 * writing a second), and applying an accepted change runs the planned writes
 * and records the proposal as applied.
 */
import React from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { TrackerDataModel } from '@nimbalyst/tracker-schema';
import type { TrackerDataCommand } from '../../../trackers/dataSource';
import { OntologyInspector } from '../OntologyInspector';
import { domainFixture, NOW, rec } from './ontologyFixture';

afterEach(cleanup);

const ENTITY = {
  type: 'entity', displayName: 'Entity', displayNamePlural: 'Entities', icon: '', color: '', modes: { inline: true, fullDocument: true }, idPrefix: 'ent', idFormat: 'ulid',
  fields: [{ name: 'kind', type: 'select', options: ['product', 'market', 'topic', 'concept', 'organization'].map((value) => ({ value, label: value })) }],
} as unknown as TrackerDataModel;

function setup(records = domainFixture()) {
  const commands: TrackerDataCommand[] = [];
  const command = vi.fn(async (input: TrackerDataCommand) => {
    commands.push(input);
    return { ok: true as const };
  });
  const view = render(<OntologyInspector types={[ENTITY]} records={records} writer={{ command, workspace: 'project-1', actor: 'me@example.test' }} now={NOW} />);
  return { commands, view };
}

test("a gap's Fix writes one proposal request, and once it exists the gap opens it instead", async () => {
  const { commands, view } = setup();
  const gap = () => view.container.querySelector('[data-gap="line:competitors:made-by"] button') as HTMLButtonElement;
  expect(gap().textContent).toBe('Fix');
  fireEvent.click(gap());
  fireEvent.click(await screen.findByRole('button', { name: 'Ask the agent to draft this' }));
  await waitFor(() => expect(commands).toHaveLength(1));
  expect(commands[0]).toMatchObject({
    type: 'create-item',
    item: { type: 'ontology-proposal', status: 'proposed', workspace: 'project-1', sharing: 'team', customFields: { healthCheck: 'line:competitors:made-by', changes: '[]' } },
  });
  // The drawer now waits on the request it wrote; the room echoes it back.
  expect(await screen.findByText('Waiting for the proposal')).toBeDefined();
  const id = (commands[0] as Extract<TrackerDataCommand, { type: 'create-item' }>).item.id;
  view.rerender(<OntologyInspector types={[ENTITY]} records={[...domainFixture(), rec(id, 'ontology-proposal', { title: 'Improve: 1 competitor has no known maker', status: 'proposed', healthCheck: 'line:competitors:made-by', changes: '[]' })]} writer={null} now={NOW} />);
  expect(await screen.findByText('Waiting for an agent to draft changes.')).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(gap().textContent).toBe('View proposal');
});

test('applying an accepted change runs its writes, then records the proposal as applied with an undo', async () => {
  const proposal = rec('P1', 'ontology-proposal', {
    title: 'Retire the concept kind',
    status: 'accepted',
    changes: JSON.stringify([{ id: 'a', type: 'reclassify-pages', toKind: 'topic', pageIds: ['Pricing'], decision: 'accepted' }]),
  });
  const { commands } = setup([...domainFixture(), proposal]);
  fireEvent.click(screen.getByRole('button', { name: /Retire the concept kind/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Apply 1 change' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(commands).toHaveLength(2));
  expect(commands[0]).toMatchObject({ type: 'update-item', input: { itemId: 'Pricing', updates: { kind: 'topic' } } });
  const saved = (commands[1] as Extract<TrackerDataCommand, { type: 'update-item' }>).input;
  expect(saved.itemId).toBe('P1');
  expect(saved.updates.status).toBe('applied');
  expect(JSON.parse(String(saved.updates.undo)).entries[0].ops).toEqual([{ op: 'restore-fields', itemId: 'Pricing', fields: { kind: 'concept' } }]);
});
