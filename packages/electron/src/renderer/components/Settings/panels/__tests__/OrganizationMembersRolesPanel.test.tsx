// @vitest-environment jsdom
import React from 'react';
import { Provider } from 'jotai';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '@nimbalyst/runtime/store';

import { DIALOG_IDS } from '../../../../dialogs/registry';
import { dialogRef } from '../../../../contexts/DialogContext';
import { OrganizationMembersRolesPanel } from '../OrganizationMembersRolesPanel';

// Narrow mock: the runtime barrel drags the whole Lexical tree in for one icon.
vi.mock('@nimbalyst/runtime/ui/icons/MaterialSymbol', () => ({
  MaterialSymbol: ({ icon }: { icon: string }) => <span>{icon}</span>,
}));

const MEMBERS = [
  { memberId: 'member-1', email: 'ada@test.com', name: 'Ada', status: 'active', role: 'member' },
];

let removeMember: ReturnType<typeof vi.fn>;
/** What the panel handed the confirm dialog, so a test can answer it. */
let confirmData: { onConfirm: () => void; onCancel: () => void } | null;

function renderPanel(callerRole: string) {
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    organization: {
      list: vi.fn(async () => ({ success: true, teams: [{ orgId: 'org-acme', name: 'Acme', role: callerRole }] })),
      listMembers: vi.fn(async () => ({ success: true, members: MEMBERS, callerRole })),
      removeMember,
    },
  };
  return render(
    <Provider store={store}>
      <OrganizationMembersRolesPanel orgId="org-acme" allowOrganizationCreation={false} />
    </Provider>,
  );
}

describe('OrganizationMembersRolesPanel removal', () => {
  beforeEach(() => {
    removeMember = vi.fn(async () => ({ success: true }));
    confirmData = null;
    dialogRef.current = {
      open: vi.fn((id: string, data: unknown) => {
        if (id === DIALOG_IDS.CONFIRM) confirmData = data as typeof confirmData;
      }),
    } as unknown as typeof dialogRef.current;
  });

  afterEach(() => {
    cleanup();
    dialogRef.current = null;
    vi.restoreAllMocks();
  });

  it('removes a member only once the confirmation is accepted', async () => {
    renderPanel('admin');
    fireEvent.click(await screen.findByTestId('organization-member-remove'));

    // Confirmation is pending: nothing may have reached the server yet.
    await waitFor(() => expect(confirmData).not.toBeNull());
    expect(removeMember).not.toHaveBeenCalled();

    confirmData!.onConfirm();
    await waitFor(() => expect(removeMember).toHaveBeenCalledWith('org-acme', 'member-1'));
  });

  it('leaves the member in place when the confirmation is dismissed', async () => {
    renderPanel('admin');
    fireEvent.click(await screen.findByTestId('organization-member-remove'));
    await waitFor(() => expect(confirmData).not.toBeNull());

    confirmData!.onCancel();
    await waitFor(() => expect(screen.getByText('Ada')).toBeTruthy());
    expect(removeMember).not.toHaveBeenCalled();
  });

  it('offers no removal to a caller who cannot administer the org', async () => {
    renderPanel('member');
    await screen.findByTestId('organization-member-row');
    expect(screen.queryByTestId('organization-member-remove')).toBeNull();
  });
});
