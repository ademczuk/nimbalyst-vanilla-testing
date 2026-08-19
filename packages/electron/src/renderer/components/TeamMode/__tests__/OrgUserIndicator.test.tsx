// @vitest-environment jsdom
/**
 * The org window's bottom-left profile menu.
 *
 * It is the only management entry point in that window (the sidebar stays
 * purely messaging, NIM-2322), so the organization row has to open the
 * management dialog *here* — the old behaviour of asking main for another OS
 * window is exactly what this replaced. "Account settings" is the one row that
 * still leaves the window, because the org window has no settings surface.
 */
import React from 'react';
import { Provider, createStore } from 'jotai';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dialogRef } from '../../../contexts/DialogContext';
import { DIALOG_IDS } from '../../../dialogs/registry';
import {
  organizationDirectoryAtom,
  personalAccountsAtom,
} from '../../../store/atoms/settingsDomains';
import { teamInboxSnapshotAtom } from '../../../store/atoms/teamInbox';
import { OrgUserIndicator } from '../OrgUserIndicator';

const ORG = { orgId: 'org-1', name: 'Acme Robotics', role: 'owner' };
const ACCOUNT = {
  personalOrgId: 'account-1',
  personalUserId: 'user-1',
  email: 'ada@example.com',
  isSyncAccount: true,
  sessionStatus: 'active' as const,
};

function installApi(overrides: Record<string, unknown> = {}) {
  const api = {
    openAccountSettings: vi.fn().mockResolvedValue({ success: true }),
    team: { openManagementWindow: vi.fn().mockResolvedValue({ success: true }) },
    ...overrides,
  };
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: api });
  return api;
}

function snapshotWithPresence(status: 'online' | 'away' | 'offline' | null) {
  return {
    status: 'ready' as const,
    deliveries: [],
    organizations: [{ orgId: 'org-1', orgName: 'Acme Robotics', status: 'ready' as const }],
    presence: status ? { 'org-1': { 'member-1': { memberId: 'member-1', status } } } : {},
  };
}

function renderIndicator(snapshot = snapshotWithPresence('online')) {
  const store = createStore();
  store.set(teamInboxSnapshotAtom, snapshot as never);
  // Both are hydrated (and emptied on sign-out) by initStytchAuthListeners,
  // which App runs for the org window too.
  store.set(personalAccountsAtom, [ACCOUNT]);
  store.set(organizationDirectoryAtom, [ORG] as never);
  const onOpenWebConsole = vi.fn();
  const onOpenPreferences = vi.fn();
  render(
    <Provider store={store}>
      <OrgUserIndicator
        selectedOrgId="org-1"
        selectedTeamMemberId="member-1"
        selectedEmail="ada@example.com"
        onOpenWebConsole={onOpenWebConsole}
        onOpenPreferences={onOpenPreferences}
      />
    </Provider>,
  );
  return { onOpenWebConsole, onOpenPreferences, store };
}

async function openMenu() {
  fireEvent.click(screen.getByTestId('org-user-indicator-button'));
  await waitFor(() => screen.getByTestId('org-user-popover'));
}

describe('OrgUserIndicator profile menu', () => {
  beforeEach(() => {
    dialogRef.current = null;
  });
  afterEach(() => {
    cleanup();
    dialogRef.current = null;
  });

  it('opens the org-management dialog in this window for the current org', async () => {
    const api = installApi();
    const open = vi.fn();
    dialogRef.current = { open } as unknown as typeof dialogRef.current;
    renderIndicator();
    await openMenu();

    // The org name comes from the directory, so the row names what it manages.
    await waitFor(() => expect(screen.getByTestId('org-user-popover-organization-row').textContent)
      .toContain('Acme Robotics'));
    fireEvent.click(screen.getByTestId('org-user-popover-organization-row'));

    expect(open).toHaveBeenCalledWith(DIALOG_IDS.ORG_MANAGEMENT, { orgId: 'org-1' });
    // No cross-window bounce: that is the behaviour this row replaced.
    expect(api.team.openManagementWindow).not.toHaveBeenCalled();
    expect(api.openAccountSettings).not.toHaveBeenCalled();
    // The menu closes behind the dialog it just opened.
    await waitFor(() => expect(screen.queryByTestId('org-user-popover')).toBeNull());
  });

  it('stops naming the organization once the user signs out', async () => {
    installApi();
    dialogRef.current = { open: vi.fn() } as unknown as typeof dialogRef.current;
    const { store } = renderIndicator();
    await openMenu();
    expect(screen.getByTestId('org-user-popover-organization-row').textContent)
      .toContain('Acme Robotics');

    // Sign-out empties both directories. The menu used to hold whatever it had
    // fetched on mount, so it kept naming an org the window no longer had.
    store.set(personalAccountsAtom, []);
    store.set(organizationDirectoryAtom, []);

    await waitFor(() => expect(screen.getByTestId('org-user-popover-organization-row').textContent)
      .not.toContain('Acme Robotics'));
  });

  it('still bounces the account row to the project window', async () => {
    const api = installApi();
    dialogRef.current = { open: vi.fn() } as unknown as typeof dialogRef.current;
    renderIndicator();
    await openMenu();

    fireEvent.click(screen.getByTestId('org-user-popover-account-row'));

    expect(api.openAccountSettings).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId('org-user-popover')).toBeNull());
  });

  it('surfaces a failed account bounce instead of closing silently', async () => {
    installApi({ openAccountSettings: vi.fn().mockResolvedValue({ success: false, error: 'No project window' }) });
    renderIndicator();
    await openMenu();

    fireEvent.click(screen.getByTestId('org-user-popover-account-row'));

    await waitFor(() => expect(screen.getByTestId('org-user-popover').textContent)
      .toContain('No project window'));
  });

  it('renders presence and connection from the inbox snapshot', async () => {
    installApi();
    renderIndicator(snapshotWithPresence('away'));
    await openMenu();

    const accountRow = screen.getByTestId('org-user-popover-account-row');
    expect(accountRow.textContent).toContain('ada@example.com');
    expect(accountRow.textContent).toContain('Away · 1 org · 0 reconnecting');
    expect(accountRow.querySelector('.org-user-popover-dot')?.className)
      .toContain('bg-[var(--nim-warning)]');
  });

  it('falls back to offline presence while an organization is reconnecting', async () => {
    installApi();
    renderIndicator({
      ...snapshotWithPresence(null),
      organizations: [
        { orgId: 'org-1', orgName: 'Acme Robotics', status: 'connecting' },
        { orgId: 'org-2', orgName: 'Beta', status: 'ready' },
      ],
    } as never);
    await openMenu();

    expect(screen.getByTestId('org-user-popover-account-row').textContent)
      .toContain('Offline · 2 orgs · 1 reconnecting');
  });

  it('keeps the popover and its trigger out of the window drag region', async () => {
    installApi();
    renderIndicator();
    await openMenu();

    expect(screen.getByTestId('org-user-indicator-button').classList).toContain('org-window-no-drag');
    expect(screen.getByTestId('org-user-popover').classList).toContain('org-window-no-drag');
  });

  it('offers the org-window-local rows: preferences and web console', async () => {
    installApi();
    const { onOpenPreferences, onOpenWebConsole } = renderIndicator();
    await openMenu();

    fireEvent.click(screen.getByTestId('org-user-popover-preferences'));
    expect(onOpenPreferences).toHaveBeenCalledTimes(1);

    await openMenu();
    fireEvent.click(screen.getByTestId('org-user-popover-web-console'));
    expect(onOpenWebConsole).toHaveBeenCalledTimes(1);
  });
});
