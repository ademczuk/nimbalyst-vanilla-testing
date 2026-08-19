// @vitest-environment node
import { createStore } from 'jotai';
import { describe, expect, it, vi } from 'vitest';

import { projectOrgRevisionAtom } from '../../atoms/orgScope';
import { stytchAuthAtom } from '../../atoms/stytchAuth';
import { initProjectOrgListeners } from '../projectOrgListeners';

function installWindow(): { broadcast: () => void; unsubscribe: ReturnType<typeof vi.fn> } {
  let listener: (() => void) | undefined;
  const unsubscribe = vi.fn();
  (globalThis as any).window = {
    electronAPI: {
      on: vi.fn((channel: string, handler: () => void) => {
        expect(channel).toBe('team:workspace-org-changed');
        listener = handler;
        return unsubscribe;
      }),
    },
  };
  return { broadcast: () => listener?.(), unsubscribe };
}

describe('initProjectOrgListeners', () => {
  it('re-resolves the project org for a window that did not run the wizard', () => {
    const jotaiStore = createStore();
    const { broadcast, unsubscribe } = installWindow();

    const cleanup = initProjectOrgListeners(jotaiStore);
    const before = jotaiStore.get(projectOrgRevisionAtom);

    broadcast();

    expect(jotaiStore.get(projectOrgRevisionAtom)).toBe(before + 1);

    cleanup();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('re-resolves on sign-out, which broadcasts no org-changed event of its own', () => {
    const jotaiStore = createStore();
    jotaiStore.set(stytchAuthAtom, { isAuthenticated: true, user: null });
    installWindow();

    initProjectOrgListeners(jotaiStore);
    const before = jotaiStore.get(projectOrgRevisionAtom);

    jotaiStore.set(stytchAuthAtom, { isAuthenticated: false, user: null });

    expect(jotaiStore.get(projectOrgRevisionAtom)).toBe(before + 1);
  });

  it('re-resolves on sign-in, so the org row appears without a reload', () => {
    const jotaiStore = createStore();
    jotaiStore.set(stytchAuthAtom, { isAuthenticated: false, user: null });
    installWindow();

    initProjectOrgListeners(jotaiStore);
    const before = jotaiStore.get(projectOrgRevisionAtom);

    jotaiStore.set(stytchAuthAtom, { isAuthenticated: true, user: null });

    expect(jotaiStore.get(projectOrgRevisionAtom)).toBe(before + 1);
  });

  it('ignores the first auth hydration, which is not a transition', () => {
    const jotaiStore = createStore();
    installWindow();

    initProjectOrgListeners(jotaiStore);
    const before = jotaiStore.get(projectOrgRevisionAtom);

    // The atom starts null; the initial fetch resolving to "signed in" must not
    // look like a sign-in, or every window re-resolves on startup.
    jotaiStore.set(stytchAuthAtom, { isAuthenticated: true, user: null });

    expect(jotaiStore.get(projectOrgRevisionAtom)).toBe(before);
  });
});
