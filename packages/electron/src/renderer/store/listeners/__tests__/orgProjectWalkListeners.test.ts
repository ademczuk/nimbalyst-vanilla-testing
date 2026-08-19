// @vitest-environment node
import { createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../contexts/DialogContext', () => ({ dialogRef: { current: null } }));
vi.mock('../../../dialogs/registry', () => ({ DIALOG_IDS: { ORG_PROJECT_WALK: 'org-project-walk' } }));
vi.mock('../../../components/TeamMode/onboarding/orgOnboardingStorage', () => ({
  readOrgProjectWalkDismissals: vi.fn(async () => []),
}));
vi.mock('../../../utils/teamAnalytics', () => ({ trackTeamAnalyticsEvent: vi.fn() }));

import { dialogRef } from '../../../contexts/DialogContext';
import { stytchAuthAtom } from '../../atoms/stytchAuth';
import { windowFocusedAtom } from '../../atoms/windowFocus';
import { initOrgProjectWalkListeners } from '../orgProjectWalkListeners';

const ACME = { orgId: 'org-acme', name: 'Acme Corp' };

function openedDialogs() {
  return (dialogRef.current?.open as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
}

describe('initOrgProjectWalkListeners', () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    (dialogRef as { current: unknown }).current = { open: vi.fn(), isOpen: vi.fn(() => false) };
    (globalThis as any).window = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      electronAPI: {
        team: {
          resolveProjectWalk: vi.fn(async () => ({
            success: true,
            orgs: [ACME],
            boundOrgIds: [],
          })),
          claimProjectWalk: vi.fn(async () => true),
        },
      },
    };
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  // Sign-in completes in an external browser, so the auth broadcast routinely
  // lands while NO window is the OS-key window. Waiting for focus is what made
  // the walk arrive minutes later, after the user had already given up looking
  // for a way in; main arbitrates instead, so it lands with the sign-in.
  it('presents as soon as sign-in lands, with no window focused', async () => {
    const store = createStore();
    store.set(windowFocusedAtom, false);
    store.set(stytchAuthAtom, { isAuthenticated: true, user: null });

    cleanup = initOrgProjectWalkListeners(store);
    await vi.waitFor(() => expect(openedDialogs()).toEqual(['org-project-walk']));
  });

  // Every window receives the auth broadcast, so exactly one may act on it.
  it('stays quiet in a window whose claim main refused', async () => {
    window.electronAPI.team.claimProjectWalk = vi.fn(async () => false);
    const store = createStore();
    store.set(windowFocusedAtom, false);
    store.set(stytchAuthAtom, { isAuthenticated: true, user: null });

    cleanup = initOrgProjectWalkListeners(store);
    await vi.waitFor(() => expect(window.electronAPI.team.claimProjectWalk).toHaveBeenCalled());
    expect(openedDialogs()).toEqual([]);
  });

  // A refused claim is not a dropped walk: the window that did win may have
  // been closed before it could present, so a later focus retries.
  it('retries a refused claim when the window is focused', async () => {
    window.electronAPI.team.claimProjectWalk = vi.fn(async () => false);
    const store = createStore();
    store.set(windowFocusedAtom, false);
    store.set(stytchAuthAtom, { isAuthenticated: true, user: null });

    cleanup = initOrgProjectWalkListeners(store);
    await vi.waitFor(() => expect(window.electronAPI.team.claimProjectWalk).toHaveBeenCalled());

    window.electronAPI.team.claimProjectWalk = vi.fn(async () => true);
    store.set(windowFocusedAtom, true);
    await vi.waitFor(() => expect(openedDialogs()).toEqual(['org-project-walk']));
  });

  // `document.hasFocus()` is true in EVERY window while the app is frontmost,
  // so the walk has to key off this window's own OS focus.
  it('presents once, in the focused window, and not again on later focus changes', async () => {
    const store = createStore();
    store.set(windowFocusedAtom, true);
    store.set(stytchAuthAtom, { isAuthenticated: true, user: null });

    cleanup = initOrgProjectWalkListeners(store);
    await vi.waitFor(() => expect(openedDialogs()).toEqual(['org-project-walk']));

    store.set(windowFocusedAtom, false);
    store.set(windowFocusedAtom, true);
    await vi.waitFor(() => expect(window.electronAPI.team.resolveProjectWalk).toHaveBeenCalledTimes(1));
    expect(openedDialogs()).toEqual(['org-project-walk']);
  });
});
