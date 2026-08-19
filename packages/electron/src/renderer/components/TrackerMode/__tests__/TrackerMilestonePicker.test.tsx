// @vitest-environment jsdom
/**
 * The milestone picker's assignment semantics.
 *
 * Three things here are invisible on screen and were each wrong once:
 *
 *  - A pick REASSIGNS. The board says a card sits in exactly the lane you
 *    dropped it in; the chip is the same gesture without the dragging, so a card
 *    in Alpha that picks Beta must end up in Beta alone -- not in both.
 *  - The `collection` field targets milestones AND releases, so a picker derived
 *    from the field's target list offers releases as milestones. Assigning one
 *    stamps `trackerType: 'milestone'` onto a release id: corrupt data that then
 *    never appears on the milestone axis again.
 *  - A milestone holding SOME of a multi-card selection is a third state. Read
 *    as "checked", the click that should place everyone in it instead clears the
 *    one card that already had it.
 *
 * Each test therefore runs the pick through the shared writer the board's drag
 * uses, and asserts the field value that lands.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import {
  loadBuiltinTrackers,
  normalizeRelationshipValue,
} from '@nimbalyst/runtime/plugins/TrackerPlugin/models';
import { trackerItemsMapAtom } from '@nimbalyst/runtime/plugins/TrackerPlugin/trackerDataAtoms';
import { TrackerMilestonePickerPanel } from '../TrackerMilestonePicker';
import { resolveMilestoneAssignmentWrites, type MilestoneAssignTarget } from '../trackerBulkAssign';

beforeAll(() => {
  loadBuiltinTrackers();
});

function record(id: string, primaryType: string, title: string, fields = {}): TrackerRecord {
  return {
    id,
    primaryType,
    typeTags: [primaryType],
    source: 'native',
    archived: false,
    syncStatus: 'local',
    system: {
      workspace: '/w',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    },
    fields: { title, status: 'draft', ...fields },
  } as unknown as TrackerRecord;
}

function membership(itemId: string, title: string, trackerType: 'milestone' | 'release') {
  return { itemId, title, trackerType, direction: 'out' as const, relationshipTypeKey: 'in-collection' };
}

const RELEASE = membership('rel_1', 'v1.0', 'release');
const ALPHA = membership('mst_alpha', 'Alpha', 'milestone');

const beta = record('mst_beta', 'milestone', 'Teams beta');
const alpha = record('mst_alpha', 'milestone', 'Alpha');
const release = record('rel_1', 'release', 'v1.0');
const otherBug = record('bug_1', 'bug', 'Something broken');

/** Render the panel over `items`; returns the assignment target a click produced. */
function pick(items: TrackerRecord[], optionId: string): MilestoneAssignTarget {
  const onAssign = vi.fn();
  const store = createStore();
  store.set(trackerItemsMapAtom, new Map(
    [...items, beta, alpha, release, otherBug].map(item => [item.id, item]),
  ));
  render(
    <Provider store={store}>
      <TrackerMilestonePickerPanel
        items={items}
        onAssign={onAssign}
        onRequestClose={vi.fn()}
        testIdBase="milestone"
      />
    </Provider>,
  );
  screen.getByTestId(`milestone-option-${optionId}`).click();
  return onAssign.mock.calls[0][0];
}

describe('milestone picker panel', () => {
  it('offers milestones only -- not the releases the same collection field targets', () => {
    const plan = record('plan_1', 'plan', 'Teams collab plan', { collection: [RELEASE] });
    const store = createStore();
    store.set(trackerItemsMapAtom, new Map(
      [plan, beta, release, otherBug].map(item => [item.id, item]),
    ));
    render(
      <Provider store={store}>
        <TrackerMilestonePickerPanel
          items={[plan]}
          onAssign={vi.fn()}
          onRequestClose={vi.fn()}
          testIdBase="milestone"
        />
      </Provider>,
    );

    expect(screen.getByTestId('milestone-option-mst_beta')).toBeDefined();
    // A release assigned here would be stored as a milestone and then be
    // invisible to every milestone surface.
    expect(screen.queryByTestId('milestone-option-rel_1')).toBeNull();
    expect(screen.queryByTestId('milestone-option-bug_1')).toBeNull();
    // The card being placed is never its own milestone.
    expect(screen.queryByTestId('milestone-option-plan_1')).toBeNull();
  });

  it('reassigns the card off its current milestone and leaves the release alone', () => {
    const plan = record('plan_1', 'plan', 'Teams collab plan', { collection: [ALPHA, RELEASE] });

    const [write] = resolveMilestoneAssignmentWrites([plan], pick([plan], 'mst_beta'));

    expect(normalizeRelationshipValue(write.updates.collection).map(v => v.itemId))
      .toEqual(['rel_1', 'mst_beta']);
  });

  it('assigns every selected card when a milestone only some of them are in is picked', () => {
    // The union-as-picker-state bug read this milestone as "checked", so the
    // click toggled it OFF and unassigned the one card that had it.
    const placed = record('plan_1', 'plan', 'Placed', { collection: [ALPHA] });
    const unplaced = record('plan_2', 'plan', 'Unplaced');
    const items = [placed, unplaced];

    const writes = resolveMilestoneAssignmentWrites(items, pick(items, 'mst_alpha'));

    // `placed` is already in exactly Alpha, so it needs no write -- and must not
    // get one that removes it.
    expect(writes.map(write => write.item.id)).toEqual(['plan_2']);
    expect(normalizeRelationshipValue(writes[0].updates.collection).map(v => v.itemId))
      .toEqual(['mst_alpha']);
  });

  it('creates a milestone, never a release, from an unmatched search', async () => {
    const createTrackerItem = vi.fn(async (_payload: Record<string, unknown>) => ({
      success: true,
      item: { id: 'mst_new', title: 'Hardening', issueKey: 'NIM-9' },
    }));
    // Assign onto jsdom's window rather than replacing it -- swapping the global
    // takes the document with it.
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      documentService: { createTrackerItem },
    };
    const onAssign = vi.fn();
    const plan = record('plan_1', 'plan', 'Teams collab plan');
    const store = createStore();
    store.set(trackerItemsMapAtom, new Map([[plan.id, plan], [beta.id, beta]]));
    render(
      <Provider store={store}>
        <TrackerMilestonePickerPanel
          items={[plan]}
          onAssign={onAssign}
          onRequestClose={vi.fn()}
          testIdBase="milestone"
        />
      </Provider>,
    );

    fireEvent.change(screen.getByTestId('milestone-search'), { target: { value: 'Hardening' } });
    await act(async () => { screen.getByTestId('milestone-create').click(); });

    expect(createTrackerItem.mock.calls[0][0]).toMatchObject({ type: 'milestone' });
    expect(onAssign.mock.calls[0][0]).toMatchObject({ itemId: 'mst_new' });
  });
});
