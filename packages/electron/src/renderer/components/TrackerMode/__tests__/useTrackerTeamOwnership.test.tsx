/**
 * The ownership sections hinge entirely on this hook's answer, and a wrong
 * answer is silent: `findTeamForWorkspace` returns null when the app is not yet
 * authenticated, which looks exactly like "this workspace has no team". Caching
 * that meant a team member's sections never appeared for the life of the window
 * — observed live, with every unit test green.
 */
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Provider, createStore } from 'jotai';
import { stytchAuthAtom } from '../../../store/atoms/stytchAuth';
import { organizationDirectoryAtom } from '../../../store/atoms/settingsDomains';
import { useTrackerTeamOwnership } from '../useTrackerTeamMembers';

const TEAM = { orgId: 'org1', name: 'Stravu', membershipType: 'active_member' };

function mockIpc(teamByCall: Array<unknown>) {
  const invoke = vi.fn(async (channel: string) => {
    if (channel === 'team:find-for-workspace') {
      return { success: true, team: teamByCall.shift() ?? null };
    }
    if (channel === 'team:list-members') {
      return { success: true, members: [{ email: 'a@x.com' }] };
    }
    return { success: true };
  });
  (window as any).electronAPI = { invoke };
  return invoke;
}

function wrapper(store: ReturnType<typeof createStore>) {
  return ({ children }: { children: React.ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
}

describe('useTrackerTeamOwnership', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not ask, or answer "solo", while auth is still unknown', async () => {
    const store = createStore(); // stytchAuthAtom starts null = not yet loaded
    const invoke = mockIpc([TEAM]);
    const { result } = renderHook(() => useTrackerTeamOwnership('/ws'), { wrapper: wrapper(store) });
    expect(result.current.team).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('resolves the team once sign-in lands, having reported no team before it', async () => {
    const store = createStore();
    const invoke = mockIpc([TEAM]);
    store.set(stytchAuthAtom, { isAuthenticated: false, user: null });
    const { result } = renderHook(() => useTrackerTeamOwnership('/ws'), { wrapper: wrapper(store) });
    await waitFor(() => expect(result.current.team).toBeNull());
    // Signed out is a definitive "no team" that needs no round trip.
    expect(invoke).not.toHaveBeenCalledWith('team:find-for-workspace', '/ws');

    store.set(stytchAuthAtom, { isAuthenticated: true, user: null });
    await waitFor(() => expect(result.current.team).toEqual({ orgId: 'org1', name: 'Stravu' }));
    expect(result.current.members).toHaveLength(1);
    expect(invoke).toHaveBeenCalledWith('team:find-for-workspace', '/ws');
  });

  it('keeps the section for a signed-in member whose roster lookup fails', async () => {
    const store = createStore();
    store.set(stytchAuthAtom, { isAuthenticated: true, user: null });
    (window as any).electronAPI = {
      invoke: vi.fn(async (channel: string) => {
        if (channel === 'team:find-for-workspace') return { success: true, team: TEAM };
        throw new Error('roster unavailable');
      }),
    };
    const { result } = renderHook(() => useTrackerTeamOwnership('/ws'), { wrapper: wrapper(store) });
    await waitFor(() => expect(result.current.team?.name).toBe('Stravu'));
    expect(result.current.members).toEqual([]);
  });

  it('re-resolves when the team list arrives, not just when auth does', async () => {
    // The live failure: signed in, but `findTeamForWorkspace` resolves against a
    // team list that has not loaded yet, so the first answer is a false "solo".
    const store = createStore();
    store.set(stytchAuthAtom, { isAuthenticated: true, user: null });
    const invoke = mockIpc([null, TEAM]);
    const { result } = renderHook(() => useTrackerTeamOwnership('/ws'), { wrapper: wrapper(store) });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('team:find-for-workspace', '/ws'));
    expect(result.current.team).toBeNull();

    store.set(organizationDirectoryAtom, [
      { orgId: 'org1', name: 'Stravu', role: 'member' },
    ]);
    await waitFor(() => expect(result.current.team?.name).toBe('Stravu'));
  });

  it('re-asks after a "no team" answer, with no signal to prompt it', async () => {
    // The live failure had no atom transition to hang a retry on: the lookup
    // itself was transiently unable to answer (auth, team list, or git remote),
    // and reported that the same way it reports a genuinely solo workspace.
    const store = createStore();
    store.set(stytchAuthAtom, { isAuthenticated: true, user: null });
    const invoke = mockIpc([null, null, TEAM]);
    const { result } = renderHook(() => useTrackerTeamOwnership('/ws'), { wrapper: wrapper(store) });
    await waitFor(() => expect(result.current.team?.name).toBe('Stravu'), { timeout: 6000 });
    expect(invoke.mock.calls.filter((c) => c[0] === 'team:find-for-workspace')).toHaveLength(3);
  });

  it('stops re-asking once the answer is a team', async () => {
    const store = createStore();
    store.set(stytchAuthAtom, { isAuthenticated: true, user: null });
    const invoke = mockIpc([TEAM, TEAM, TEAM]);
    const { result } = renderHook(() => useTrackerTeamOwnership('/ws'), { wrapper: wrapper(store) });
    await waitFor(() => expect(result.current.team?.name).toBe('Stravu'));
    await new Promise((r) => setTimeout(r, 1200));
    expect(invoke.mock.calls.filter((c) => c[0] === 'team:find-for-workspace')).toHaveLength(1);
  });

  it('treats a pending invite as no team', async () => {
    const store = createStore();
    store.set(stytchAuthAtom, { isAuthenticated: true, user: null });
    mockIpc([{ ...TEAM, membershipType: 'invited_member' }]);
    const { result } = renderHook(() => useTrackerTeamOwnership('/ws'), { wrapper: wrapper(store) });
    await waitFor(() => expect(result.current.team).toBeNull());
  });
});
