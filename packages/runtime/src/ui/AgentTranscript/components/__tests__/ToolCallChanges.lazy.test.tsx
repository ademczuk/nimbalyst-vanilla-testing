import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToolCallChanges } from '../ToolCallChanges';

describe('ToolCallChanges lazy hydration', () => {
  it('does not request history diffs until the user opens File Changes', async () => {
    const loadDiffs = vi.fn().mockResolvedValue({
      state: 'ready',
      diffs: [{
        filePath: '/workspace/a.ts',
        operation: 'edit',
        diffs: [{ oldString: 'before\n', newString: 'after\n' }],
        linesAdded: 1,
        linesRemoved: 1,
      }],
      omissions: [],
    });

    render(<ToolCallChanges diffs={undefined} isExpanded loadDiffs={loadDiffs} />);

    expect(loadDiffs).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /file changes/i }));

    await waitFor(() => expect(loadDiffs).toHaveBeenCalledTimes(1));
    expect((await screen.findAllByText('/workspace/a.ts')).length).toBeGreaterThan(0);
  });

  it('renders an input-limit omission as an expected result', async () => {
    const loadDiffs = vi.fn().mockResolvedValue({
      state: 'partial',
      diffs: [],
      omissions: [{ filePath: '/workspace/large.json', reason: 'input-too-large' }],
    });

    render(<ToolCallChanges diffs={undefined} isExpanded loadDiffs={loadDiffs} />);
    fireEvent.click(screen.getByRole('button', { name: /file changes/i }));

    expect(await screen.findByText(/too large to compare safely/i)).toBeTruthy();
  });
});
