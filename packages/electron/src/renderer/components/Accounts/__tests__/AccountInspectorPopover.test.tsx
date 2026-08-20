// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AccountInspectorPopover } from '../AccountInspectorPopover';

function anchor(): HTMLElement {
  const el = document.createElement('button');
  document.body.appendChild(el);
  return el;
}

describe('AccountInspectorPopover', () => {
  afterEach(() => cleanup());

  it('shows one Account row (email → account screen) and one Organization row (project org → org screen)', () => {
    const onOpenAccount = vi.fn();
    const onManageOrganization = vi.fn();
    render(
      <AccountInspectorPopover
        accounts={[
          { personalOrgId: 'sync', personalUserId: 'u1', email: 'me@example.com', isSyncAccount: true, sessionStatus: 'active' },
          { personalOrgId: 'other', personalUserId: 'u2', email: 'other@example.com', isSyncAccount: false, sessionStatus: 'active' },
        ]}
        projectOrg={{ orgId: 'org-work', name: 'Work Team' }}
        anchorEl={anchor()}
        onClose={vi.fn()}
        onOpenAccount={onOpenAccount}
        onManageOrganization={onManageOrganization}
        onOpenApplicationSettings={vi.fn()}
        onOpenProjectSettings={vi.fn()}
      />,
    );

    // The active (sync) account's email appears, not a list of every account/project.
    screen.getByText('me@example.com');
    expect(screen.queryByText('other@example.com')).toBeNull();
    screen.getByText('Work Team');

    fireEvent.click(screen.getByTestId('account-inspector-account-row'));
    expect(onOpenAccount).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('account-inspector-organization-row'));
    expect(onManageOrganization).toHaveBeenCalledWith('org-work');
  });

  it('links to Application and Project settings', () => {
    const onOpenApplicationSettings = vi.fn();
    const onOpenProjectSettings = vi.fn();
    render(
      <AccountInspectorPopover
        accounts={[]}
        projectOrg={null}
        anchorEl={anchor()}
        onClose={vi.fn()}
        onOpenAccount={vi.fn()}
        onManageOrganization={vi.fn()}
        onOpenApplicationSettings={onOpenApplicationSettings}
        onOpenProjectSettings={onOpenProjectSettings}
      />,
    );

    fireEvent.click(screen.getByTestId('account-inspector-application-settings-row'));
    expect(onOpenApplicationSettings).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('account-inspector-project-settings-row'));
    expect(onOpenProjectSettings).toHaveBeenCalledTimes(1);
  });

  // The reported bug: when the project had no org the row named one of the
  // account's organizations at random and offered only that one's project walk
  // — a flow that leads *away* from the open project. There was no way to pick
  // a different organization, and no way to create one. It now leads to the
  // sharing flow, which asks which, and must do so for a member of several orgs
  // just as much as for an account with none.
  it('routes an org-less project to the sharing flow rather than naming an arbitrary org', () => {
    const onManageOrganization = vi.fn();
    const onAddProjectToOrganization = vi.fn();
    render(
      <AccountInspectorPopover
        accounts={[]}
        projectOrg={null}
        anchorEl={anchor()}
        onClose={vi.fn()}
        onOpenAccount={vi.fn()}
        onManageOrganization={onManageOrganization}
        onAddProjectToOrganization={onAddProjectToOrganization}
        onOpenApplicationSettings={vi.fn()}
        onOpenProjectSettings={vi.fn()}
      />,
    );

    screen.getByText('Sign in');
    fireEvent.click(screen.getByTestId('account-inspector-add-to-organization-row'));
    expect(onAddProjectToOrganization).toHaveBeenCalledTimes(1);
    expect(onManageOrganization).not.toHaveBeenCalled();
  });

  // An unresolved lookup used to render as "No organization -- Set up", which
  // offered org creation to a user who had just finished it.
  it('does not offer org setup while the organization lookup is still running', () => {
    render(
      <AccountInspectorPopover
        accounts={[]}
        projectOrg={null}
        projectOrgLoading
        anchorEl={anchor()}
        onClose={vi.fn()}
        onOpenAccount={vi.fn()}
        onManageOrganization={vi.fn()}
        onOpenApplicationSettings={vi.fn()}
        onOpenProjectSettings={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('account-inspector-organization-row')).toBeNull();
    screen.getByTestId('account-inspector-organization-loading');
  });

  // Sync gave up its gutter slot to this row, so the row has to be the thing
  // that appears — and it must stay away entirely for a user with no sync,
  // who is exactly who the old gutter icon hid itself from.
  it('shows the sync row only when there is sync state, and links it to settings', () => {
    const onOpenSyncSettings = vi.fn();
    const { rerender } = render(
      <AccountInspectorPopover
        accounts={[]}
        projectOrg={null}
        anchorEl={anchor()}
        onClose={vi.fn()}
        onOpenAccount={vi.fn()}
        onManageOrganization={vi.fn()}
        onOpenApplicationSettings={vi.fn()}
        onOpenProjectSettings={vi.fn()}
        sync={null}
      />,
    );
    expect(screen.queryByTestId('account-inspector-sync-row')).toBeNull();

    rerender(
      <AccountInspectorPopover
        accounts={[]}
        projectOrg={null}
        anchorEl={anchor()}
        onClose={vi.fn()}
        onOpenAccount={vi.fn()}
        onManageOrganization={vi.fn()}
        onOpenApplicationSettings={vi.fn()}
        onOpenProjectSettings={vi.fn()}
        sync={{ tone: 'warning', detail: 'Disconnected', needsAttention: true }}
        onOpenSyncSettings={onOpenSyncSettings}
      />,
    );

    const row = screen.getByTestId('account-inspector-sync-row');
    expect(row.getAttribute('data-sync-tone')).toBe('warning');
    screen.getByText('Disconnected');
    fireEvent.click(row);
    expect(onOpenSyncSettings).toHaveBeenCalledTimes(1);
  });
});
