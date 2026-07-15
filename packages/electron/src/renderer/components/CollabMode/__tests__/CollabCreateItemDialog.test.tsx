// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CollabCreateItemDialog } from '../CollabCreateItemDialog';
import type { SharedFolder } from '../../../store/atoms/collabDocuments';

vi.mock('@nimbalyst/runtime', () => ({
  MaterialSymbol: ({ icon }: { icon: string }) => <span data-icon={icon} />,
}));

const folders: SharedFolder[] = [
  {
    folderId: 'f-specs',
    name: 'Specs',
    parentFolderId: null,
    sortOrder: 0,
    createdBy: 'user-1',
    createdAt: 1,
    updatedAt: 1,
  },
  {
    folderId: 'f-api',
    name: 'API',
    parentFolderId: 'f-specs',
    sortOrder: 0,
    createdBy: 'user-1',
    createdAt: 1,
    updatedAt: 1,
  },
];

afterEach(cleanup);

describe('CollabCreateItemDialog', () => {
  it('lets a user retarget creation from a selected folder to Root', () => {
    const onConfirm = vi.fn();

    function Harness() {
      const [targetFolderId, setTargetFolderId] = useState<string | null>('f-specs');
      return (
        <CollabCreateItemDialog
          isOpen
          kind="folder"
          folders={folders}
          targetFolderId={targetFolderId}
          onTargetFolderChange={setTargetFolderId}
          onConfirm={onConfirm}
          onCancel={() => {}}
        />
      );
    }

    render(<Harness />);
    const embeddedPicker = screen.getByTestId('collab-create-location-picker');
    expect(screen.getByText('Pick where this folder should live in your team space.')).toBeTruthy();
    expect(embeddedPicker.textContent).toContain('Team root');
    expect(embeddedPicker.textContent).toContain('Specs');
    expect(embeddedPicker.textContent).toContain('API');
    expect(embeddedPicker.getAttribute('role')).toBe('tree');
    expect(screen.getByTestId('collab-create-location-option-root').querySelector('button')).toBeNull();
    expect(screen.getByTestId('collab-create-location-option-f-specs').getAttribute('aria-selected')).toBe('true');

    fireEvent.click(screen.getByTestId('collab-create-location-option-root'));
    expect(screen.getByTestId('collab-create-location-option-root').getAttribute('aria-selected')).toBe('true');

    fireEvent.change(screen.getByTestId('collab-create-name-input'), {
      target: { value: 'Architecture' },
    });
    expect(screen.getByText('Will be created as')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create Folder' }));
    expect(onConfirm).toHaveBeenCalledWith('Architecture');
  });
});
