import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { describe, expect, it } from 'vitest';

import type { TrackerRecord } from '../../../core/TrackerRecord';
import { trackerItemsMapAtom } from '../../TrackerPlugin/trackerDataAtoms';
import { TrackerReferenceChip } from '../TrackerReferenceChip';

const trackerRecord: TrackerRecord = {
  id: 'bug_1',
  issueKey: 'NIM-1',
  primaryType: 'bug',
  typeTags: ['bug'],
  source: 'native',
  archived: false,
  syncStatus: 'synced',
  system: {
    workspace: '/workspace',
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
  },
  fields: {
    title: 'Theme-safe tracker preview',
    status: 'in-progress',
    priority: 'medium',
  },
};

describe('TrackerReferenceChip', () => {
  it('uses canonical theme tokens for the shared chip and preview', () => {
    const store = createStore();
    store.set(trackerItemsMapAtom, new Map([[trackerRecord.id, trackerRecord]]));

    const { container } = render(
      <Provider store={store}>
        <TrackerReferenceChip referenceKey="NIM-1" />
      </Provider>,
    );

    const chip = container.querySelector<HTMLElement>('.tracker-reference-chip');
    expect(chip?.style.background).toBe('var(--nim-bg-secondary)');
    expect(chip?.style.border).toContain('var(--nim-border)');

    fireEvent.click(screen.getByText('NIM-1'));

    const preview = document.querySelector<HTMLElement>(
      '.tracker-reference-preview > div',
    );
    expect(preview?.style.background).toBe('var(--nim-bg)');
    expect(preview?.style.color).toBe('var(--nim-text)');
    expect(preview?.style.border).toContain('var(--nim-border)');

    const button = screen.getByRole('button', { name: 'Go to item' });
    expect(button.style.background).toBe('var(--nim-bg-secondary)');
    expect(button.style.color).toBe('var(--nim-text)');
  });
});
