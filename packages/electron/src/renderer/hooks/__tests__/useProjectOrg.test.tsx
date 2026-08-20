/**
 * The account popover resolved the project's organization exactly once per
 * workspace, so an org created while the window was open never appeared: the
 * row kept offering "Set up" for an org that already existed.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useProjectOrg } from '../useProjectOrg';
import { activeWorkspacePathAtom } from '../../store/atoms/openProjects';
import { projectOrgRevisionAtom } from '../../store/atoms/orgScope';
import { stytchAuthAtom } from '../../store/atoms/stytchAuth';
import { shouldLeaveOrgMode } from '../../../shared/orgProjectWalk';

const findForWorkspace = vi.fn();
/** Every value the hook reported, so a wrong one cannot flash by unseen. */
const reported: string[] = [];

function Probe() {
  const { org, loading } = useProjectOrg('/projects/plain-folder');
  const text = loading ? 'loading' : org?.name ?? 'none';
  reported.push(text);
  return <span data-testid="probe">{text}</span>;
}

/** What App does with the same answer: leave Org mode, or stay in it. */
function OrgModeProbe() {
  const { org, loading } = useProjectOrg('/projects/plain-folder');
  const leaving = shouldLeaveOrgMode({
    activeMode: 'org',
    projectOrg: org,
    projectOrgLoading: loading,
  });
  return <span data-testid="probe">{leaving ? 'bounced-to-files' : org?.name ?? 'org-mode'}</span>;
}

describe('useProjectOrg', () => {
  beforeEach(() => {
    findForWorkspace.mockReset();
    reported.length = 0;
    (window as any).electronAPI = { team: { findForWorkspace } };
  });

  it('reports the lookup as pending rather than as "no organization"', async () => {
    let resolveLookup: (value: unknown) => void = () => {};
    findForWorkspace.mockReturnValue(new Promise((resolve) => { resolveLookup = resolve; }));
    const store = createStore();
    store.set(activeWorkspacePathAtom, '/projects/plain-folder');

    render(<Provider store={store}><Probe /></Provider>);

    expect(screen.getByTestId('probe').textContent).toBe('loading');

    resolveLookup({ team: null });
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('none'));
  });

  it('re-resolves when the project org revision is bumped', async () => {
    findForWorkspace
      .mockResolvedValueOnce({ team: null })
      .mockResolvedValueOnce({ team: { orgId: 'org-new', name: 'Acme' } });
    const store = createStore();
    store.set(activeWorkspacePathAtom, '/projects/plain-folder');

    render(<Provider store={store}><Probe /></Provider>);
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('none'));

    store.set(projectOrgRevisionAtom, (revision) => revision + 1);

    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('Acme'));
  });

  it('drops the previous answer while re-resolving, so a signed-out window never shows its old org', async () => {
    let resolveLookup: (value: unknown) => void = () => {};
    findForWorkspace
      .mockResolvedValueOnce({ team: { orgId: 'org-1', name: 'Acme' } })
      .mockReturnValueOnce(new Promise((resolve) => { resolveLookup = resolve; }));
    const store = createStore();
    store.set(activeWorkspacePathAtom, '/projects/plain-folder');

    render(<Provider store={store}><Probe /></Provider>);
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('Acme'));

    store.set(projectOrgRevisionAtom, (revision) => revision + 1);

    // Sign-out bumps the revision; holding "Acme" until the lookup answers is
    // what left the org row standing in a signed-out window.
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('loading'));

    resolveLookup({ team: null });
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('none'));
  });

  it('holds a lookup that could not be carried out open until auth has loaded', async () => {
    findForWorkspace
      .mockResolvedValueOnce({ success: true, team: null, complete: false })
      .mockResolvedValueOnce({ success: true, team: { orgId: 'org-1', name: 'Acme' }, complete: true });
    const store = createStore();
    store.set(activeWorkspacePathAtom, '/projects/plain-folder');

    render(<Provider store={store}><Probe /></Provider>);

    await waitFor(() => expect(findForWorkspace).toHaveBeenCalledTimes(1));
    // Main had no session yet, so it could not ask. A `null` from that lookup
    // is "ask again later", not "this project has no organization" -- caching
    // it as an answer is what left the org invisible for the life of the window.
    expect(screen.getByTestId('probe').textContent).toBe('loading');

    store.set(stytchAuthAtom, { isAuthenticated: true, user: null });

    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('Acme'));
  });

  /**
   * The cold start a single retry does not survive.
   *
   * The auth snapshot hydrates as authenticated well before main can fetch the
   * team directory, so "auth has loaded" cannot stand in for "main answered".
   * Resolving on it cached the pre-directory `null` and the window spent its
   * life believing the project had no organization — the gutter's Organization
   * item bounced straight back to Files.
   */
  it('keeps asking until main can carry the lookup out, not just once', async () => {
    findForWorkspace
      .mockResolvedValueOnce({ success: true, team: null, complete: false })
      .mockResolvedValueOnce({ success: true, team: null, complete: false })
      .mockResolvedValue({ success: true, team: { orgId: 'org-1', name: 'Acme' }, complete: true });
    const store = createStore();
    store.set(activeWorkspacePathAtom, '/projects/plain-folder');
    store.set(stytchAuthAtom, { isAuthenticated: true, user: null });

    render(<Provider store={store}><Probe /></Provider>);

    await waitFor(
      () => expect(screen.getByTestId('probe').textContent).toBe('Acme'),
      { timeout: 5000 },
    );
    expect(findForWorkspace).toHaveBeenCalledTimes(3);
    // Never a resolved "no organization" along the way: that is the answer that
    // gets cached and stands for the life of the window.
    expect(reported).not.toContain('none');
  });

  it('answers once auth has loaded, so a signed-out window never spins', async () => {
    // Signed out is also a lookup main cannot carry out, and it never resolves
    // any further -- the answer has to land rather than wait forever.
    findForWorkspace.mockResolvedValue({ success: true, team: null, complete: false });
    const store = createStore();
    store.set(activeWorkspacePathAtom, '/projects/plain-folder');
    store.set(stytchAuthAtom, { isAuthenticated: false, user: null });

    render(<Provider store={store}><Probe /></Provider>);

    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('none'));
  });

  it('keeps a window in Org mode while the lookup is unresolved', async () => {
    findForWorkspace
      .mockResolvedValueOnce({ success: true, team: null, complete: false })
      .mockResolvedValueOnce({ success: true, team: { orgId: 'org-1', name: 'Acme' }, complete: true });
    const store = createStore();
    store.set(activeWorkspacePathAtom, '/projects/plain-folder');

    render(<Provider store={store}><OrgModeProbe /></Provider>);

    // Clicking the gutter's Organization item used to land in Files: App read
    // the pre-auth `null` as "no organization" and bounced straight back out.
    await waitFor(() => expect(findForWorkspace).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('probe').textContent).toBe('org-mode');

    store.set(stytchAuthAtom, { isAuthenticated: true, user: null });

    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('Acme'));
  });
});
