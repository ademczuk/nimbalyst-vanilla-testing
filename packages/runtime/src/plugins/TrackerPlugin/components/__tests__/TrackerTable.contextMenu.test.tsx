// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import type { TrackerRecord } from '../../../../core/TrackerRecord';
import { loadBuiltinTrackers } from '../../models';
import { trackerItemsMapAtom } from '../../trackerDataAtoms';
import { TrackerTable } from '../TrackerTable';

vi.mock('posthog-js/react', () => ({
  usePostHog: () => ({ capture: vi.fn() }),
}));

function record(id: string): TrackerRecord {
  return {
    id,
    primaryType: 'bug',
    typeTags: ['bug'],
    issueKey: id.toUpperCase(),
    source: 'native',
    archived: false,
    syncStatus: 'local',
    system: {
      workspace: '/ws',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      lastIndexed: '2026-08-01T00:00:00.000Z',
    },
    fields: { title: `Title ${id}`, status: 'to-do', priority: 'medium' },
  } as TrackerRecord;
}

describe('TrackerTable context menu trigger', () => {
  beforeAll(() => loadBuiltinTrackers());

  beforeEach(() => {
    (window as any).electronAPI = {
      documentService: { updateTrackerItem: vi.fn() },
    };
  });

  it('preserves a multi-selection when its overflow action opens the shared menu', () => {
    render(
      <TrackerTable
        filterType="bug"
        hideTypeTabs
        hideToolbar
        overrideItems={[record('bug-1'), record('bug-2')]}
      />,
    );

    const rows = screen.getAllByTestId('tracker-table-row');
    fireEvent.click(rows[0], { metaKey: true });
    fireEvent.click(rows[1], { metaKey: true });
    fireEvent.click(screen.getAllByTestId('tracker-row-more-actions')[1]);

    expect(screen.getByText('2 items selected')).toBeDefined();
  });
});

describe('TrackerTable collection cell', () => {
  beforeAll(() => loadBuiltinTrackers());

  it('names a collection from the live record, not the link snapshot', () => {
    const milestone = {
      ...record('mst_1'),
      primaryType: 'milestone',
      typeTags: ['milestone'],
      fields: { title: 'Onboarding' },
    } as TrackerRecord;
    getDefaultStore().set(trackerItemsMapAtom, new Map([[milestone.id, milestone]]));

    const bug = record('bug-1');
    // A link written from the milestone's side carries no title, so the cell
    // would otherwise read as the raw item id.
    bug.fields.collection = [{ itemId: 'mst_1', trackerType: 'milestone' }];

    render(
      <TrackerTable
        filterType="bug"
        hideTypeTabs
        hideToolbar
        overrideItems={[bug]}
        columnConfig={{ visibleColumns: ['title', 'collection'], columnWidths: {} }}
      />,
    );

    expect(screen.getByText('Onboarding')).toBeDefined();
    expect(screen.queryByText('mst_1')).toBeNull();
  });
});
