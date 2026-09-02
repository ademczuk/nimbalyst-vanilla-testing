/**
 * What the invite dialog says about publishing.
 *
 * The regression this guards is not visual: the dialog urged an admin to
 * publish folders "so there is something to open", and warned that the
 * invitee would "arrive to an empty workspace", for a team whose shared space
 * was already full. Both are claims about the team, and neither is visible as
 * wrong on screen without knowing what the team holds.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TeamSharedContent } from '../useTeamSharedContent';

let sharedContent: TeamSharedContent = 'empty';

vi.mock('../useTeamSharedContent', () => ({
  useTeamSharedContent: () => sharedContent,
}));
vi.mock('../WorkspaceFolderPicker', () => ({
  WorkspaceFolderPicker: () => <div data-testid="folder-picker" />,
}));
vi.mock('@nimbalyst/runtime/ui/icons/MaterialSymbol', () => ({
  MaterialSymbol: () => null,
}));

const { InviteToTeamDialog } = await import('../InviteToTeamDialog');

function renderDialog() {
  return render(
    <InviteToTeamDialog
      isOpen
      orgId="org-1"
      orgName="Acme"
      projects={[{ teamProjectId: 'tp-1', name: 'Acme', isPrimary: true }]}
      workspacePath="/tmp/workspace"
      onClose={() => {}}
      onInvited={() => {}}
    />,
  );
}

function typeInvitee() {
  fireEvent.change(screen.getByLabelText('Email addresses'), {
    target: { value: 'teammate@example.com' },
  });
}

describe('InviteToTeamDialog publishing guidance', () => {
  beforeEach(() => {
    sharedContent = 'empty';
  });

  it('urges a publish, and warns about an empty arrival, only for an empty team', () => {
    renderDialog();
    typeInvitee();
    screen.getByText(/so there is something to open/);
    screen.getByTestId('folder-picker');
    screen.getByText(/arrive to an empty workspace/);
  });

  it('stops urging, and collapses the picker, once the team has shared content', () => {
    sharedContent = 'has-content';
    renderDialog();
    typeInvitee();
    expect(screen.queryByText(/so there is something to open/)).toBeNull();
    expect(screen.queryByTestId('folder-picker')).toBeNull();
    expect(screen.queryByText(/arrive to an empty workspace/)).toBeNull();
    // Still reachable: publishing more is legitimate, just not recommended.
    fireEvent.click(screen.getByRole('button', { name: /Publish folders from this workspace too/ }));
    screen.getByTestId('folder-picker');
  });

  it('makes no claim about the team while the answer is unknown', () => {
    sharedContent = 'unknown';
    renderDialog();
    typeInvitee();
    expect(screen.queryByText(/so there is something to open/)).toBeNull();
    expect(screen.queryByText(/arrive to an empty workspace/)).toBeNull();
    screen.getByTestId('folder-picker');
  });
});
