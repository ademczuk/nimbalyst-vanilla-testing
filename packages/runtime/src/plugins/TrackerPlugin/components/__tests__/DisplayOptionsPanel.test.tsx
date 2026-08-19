/**
 * The Display Settings panel and the selects inside it are separate floating
 * layers, so a press inside the grouping dropdown must not read as a press
 * outside the panel — that dismissal used to unmount the option before its
 * click landed, making grouping unpickable.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { DisplayOptionsPanel } from '../DisplayOptionsPanel';
import type { TrackerColumnDef } from '../trackerColumns';

vi.mock('../../../../ui/icons/MaterialSymbol', () => ({
  MaterialSymbol: ({ icon }: { icon: string }) => <span data-icon={icon} />,
}));

const availableColumns: TrackerColumnDef[] = [
  { id: 'title', label: 'Title', defaultVisible: true },
  { id: 'status', label: 'Status', defaultVisible: true },
] as TrackerColumnDef[];

function renderPanel() {
  const onGroupByChange = vi.fn();
  const onClose = vi.fn();
  const anchor = document.createElement('button');
  document.body.appendChild(anchor);
  const utils = render(
    <DisplayOptionsPanel
      availableColumns={availableColumns}
      config={{ visibleColumns: ['title'], columnWidths: {} }}
      onConfigChange={vi.fn()}
      onClose={onClose}
      anchorElement={anchor}
      groupBy="none"
      onGroupByChange={onGroupByChange}
      showColumnProperties={false}
    />,
  );
  return { onGroupByChange, onClose, anchor, ...utils };
}

describe('DisplayOptionsPanel grouping select', () => {
  it('selects a grouping option instead of dismissing the panel', () => {
    const { onGroupByChange, onClose } = renderPanel();

    fireEvent.click(within(screen.getByTestId('tracker-display-group-by')).getByRole('button'));
    const option = screen.getByRole('button', { name: 'Status' });

    fireEvent.mouseDown(option);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(option);
    expect(onGroupByChange).toHaveBeenCalledWith('status');
  });

  it('still closes when the press lands outside every layer', () => {
    const { onClose } = renderPanel();
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalled();
  });
});
