import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TrackerDataCommand, TrackerItem } from '../../../trackers/dataSource';
import { createTrackerReferenceResolver, type TrackerReferenceResolver } from '../trackerReferenceResolver';
import { TrackerReferenceResolverProvider } from '../TrackerReferenceResolverContext';
import { LiveTrackerReferenceRenderer } from '../TrackerReferenceViews';
import { fakeDataSource, fakeSchema, item } from './referenceFixtures';

afterEach(cleanup);

const actor = () => ({ email: 'sam@example.test', name: 'Sam' });

/**
 * Renders one card per item. `command` answers every data-source write and,
 * like the real data source, publishes the updated item before resolving.
 */
async function setup(items: TrackerItem[], options: { resolver?: (r: TrackerReferenceResolver) => TrackerReferenceResolver } = {}) {
  const fake = fakeDataSource();
  const current = new Map(items.map((entry) => [entry.id, entry]));
  const command = vi.spyOn(fake.source, 'command').mockImplementation(async (cmd: TrackerDataCommand) => {
    if (cmd.type === 'update-item') {
      const next = { ...current.get(cmd.input.itemId)!, ...cmd.input.updates } as TrackerItem;
      current.set(next.id, next);
      fake.emit({ type: 'items-upserted', items: [next] });
    }
    return { ok: true } as never;
  });
  const base = createTrackerReferenceResolver(fake.source, { schema: fakeSchema(), onOpenItem: vi.fn(), currentActor: actor });
  const resolver = options.resolver ? options.resolver(base) : base;
  render(
    <TrackerReferenceResolverProvider resolver={resolver}>
      {items.map((entry) => (
        <LiveTrackerReferenceRenderer key={entry.id} referenceKey={entry.issueKey!} nodeKey={entry.id} view="card" />
      ))}
    </TrackerReferenceResolverProvider>,
  );
  await act(() => fake.release(items));
  const click = (element: HTMLElement) => act(async () => { element.click(); });
  const updates = () => command.mock.calls
    .map(([cmd]) => cmd)
    .filter((cmd): cmd is Extract<TrackerDataCommand, { type: 'update-item' }> => cmd.type === 'update-item')
    .map((cmd) => cmd.input.updates);
  return { command, click, updates };
}

const decision = (overrides: Partial<TrackerItem> = {}) => item({
  id: 'd-1', issueKey: 'KW-13', type: 'wiki-decision', title: 'Store pages as files', status: 'proposed', ...overrides,
});

describe('embedded box writes', () => {
  it('Apply runs only a valid transition, and asks for its field before writing', async () => {
    const question = item({
      id: 'q-1', issueKey: 'KW-14', type: 'question', title: 'Built in?', status: 'open',
      customFields: { agentProposal: { by: 'Claude', kind: 'status', toStatus: 'answered', reason: 'Shipped as built in' } },
    });
    const rejecting = decision({
      customFields: { agentProposal: { by: 'Claude', kind: 'status', toStatus: 'rejected', reason: 'Files cannot carry owners' } },
    });
    const { click, updates } = await setup([question, rejecting]);

    // No proposed position: answering is not a valid transition, so only Dismiss is offered.
    const applyButtons = screen.getAllByRole('button', { name: 'Apply' });
    expect(applyButtons).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Dismiss' })).toHaveLength(2);

    await click(applyButtons[0]);
    expect(updates()).toEqual([]);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Files cannot carry owners');
    await click(screen.getByRole('button', { name: 'Reject' }));
    expect(updates()).toEqual([expect.objectContaining({
      status: 'rejected', whyNot: 'Files cannot carry owners', decidedBy: 'sam@example.test', agentProposal: null,
    })]);
  });

  it('Delete archives the proposed item recoverably, and is hidden when nothing can delete it', async () => {
    const proposed = item({
      id: 'q-2', issueKey: 'KW-20', type: 'question', title: 'Plan files?', status: 'open',
      customFields: { agentProposal: { by: 'Claude', kind: 'create', reason: 'Not covered' } },
    });
    const { command, click } = await setup([proposed]);
    await click(screen.getByRole('button', { name: 'Delete' }));
    expect(command).toHaveBeenLastCalledWith({ type: 'archive-item', itemId: 'q-2', archive: true });
    screen.getByText(/Deleted KW-20/);
    await click(screen.getByRole('button', { name: 'Undo' }));
    expect(command).toHaveBeenLastCalledWith({ type: 'archive-item', itemId: 'q-2', archive: false });
    screen.getByText('Plan files?');
    cleanup();

    // A claim has no cancelled status; without archive support there is no honest Delete.
    const claim = item({
      id: 'c-1', issueKey: 'KW-30', type: 'claim', title: 'A claim', status: 'asserted',
      customFields: { agentProposal: { by: 'Claude', kind: 'create' } },
    });
    await setup([claim], { resolver: (r) => ({ ...r, archiveItem: undefined }) });
    screen.getByRole('button', { name: 'Keep' });
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('Undo survives a failed write and restores absent fields as absent', async () => {
    const { command, click, updates } = await setup([decision()]);
    await click(screen.getByRole('button', { name: 'Proposed' }));
    await click(screen.getByRole('menuitem', { name: /Accepted/ }));
    screen.getByText(/You accepted/);

    command.mockRejectedValueOnce(new Error('offline'));
    await click(screen.getByRole('button', { name: 'Undo' }));
    screen.getByText(/offline/);

    await click(screen.getByRole('button', { name: 'Undo' }));
    const restore = updates().at(-1)!;
    expect(restore.status).toBe('proposed');
    // decidedBy / decidedAt did not exist before: undefined (dropped by the JSON wire encoding), not null.
    expect(Object.keys(restore).sort()).toEqual(['decidedAt', 'decidedBy', 'status']);
    expect([restore.decidedBy, restore.decidedAt]).toEqual([undefined, undefined]);
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('does not ring or credit someone else for your own change', async () => {
    const { click } = await setup([decision()]);
    await click(screen.getByRole('button', { name: 'Proposed' }));
    await click(screen.getByRole('menuitem', { name: /Accepted/ }));
    expect(document.querySelector('[data-ring="true"]')).toBeNull();
    expect(screen.queryByText(/Someone accepted/)).toBeNull();
    screen.getByText(/You accepted/);
  });

  it('Superseded asks for the replacement and writes it only once the key resolves', async () => {
    const replacement = decision({ id: 'd-2', issueKey: 'KW-24', title: 'Nested folders', status: 'accepted' });
    const { click, updates } = await setup([decision(), replacement]);
    await click(screen.getByRole('button', { name: 'Proposed' }));
    await click(screen.getByRole('menuitem', { name: /Superseded/ }));

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'KW-404' } });
    expect((screen.getByRole('button', { name: 'Supersede' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'kw-24' } });
    await click(screen.getByRole('button', { name: 'Supersede' }));
    expect(updates()).toEqual([{ status: 'superseded', supersededBy: { itemId: 'd-2' } }]);
  });
});
