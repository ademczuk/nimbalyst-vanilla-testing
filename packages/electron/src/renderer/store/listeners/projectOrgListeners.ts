import type { Store } from 'jotai/vanilla/store';

// The store singleton, not the `store/index` barrel, which would drag every
// renderer atom module in behind it.
import { store } from '@nimbalyst/runtime/store';
import { projectOrgRevisionAtom } from '../atoms/orgScope';
import { stytchAuthAtom } from '../atoms/stytchAuth';

/**
 * Installs the renderer-wide subscription for "this workspace's organization
 * changed".
 *
 * Which org a project belongs to is resolved once per workspace, so creating
 * one had to invalidate that answer explicitly. Doing it in the wizard only
 * reached the window the wizard was in; main broadcasts to every window, which
 * is where the other project windows come from.
 *
 * The payload is deliberately not read: the revision is a "re-resolve" signal,
 * and the windows that care each ask for their own workspace.
 *
 * Signing in or out changes the answer too, and `signOut()` broadcasts no
 * org-changed event — only the auth state. Without this the account popover kept
 * showing the organization row (and its Messages row) next to a "Sign in"
 * account row until the window was reloaded, and the mirror case left a
 * freshly signed-in window claiming it had no org.
 */
export function initProjectOrgListeners(targetStore: Store = store): () => void {
  const unsubscribeOrgChanged = window.electronAPI.on('team:workspace-org-changed', () => {
    targetStore.set(projectOrgRevisionAtom, (revision) => revision + 1);
  });

  // Only a real sign-in/sign-out flips the answer. The atom starts null while
  // the initial auth fetch is in flight; treating that first hydration as a
  // transition would re-resolve in every window on startup.
  let wasAuthenticated = targetStore.get(stytchAuthAtom)?.isAuthenticated ?? null;
  const unsubscribeAuth = targetStore.sub(stytchAuthAtom, () => {
    const isAuthenticated = targetStore.get(stytchAuthAtom)?.isAuthenticated ?? null;
    if (isAuthenticated === null || wasAuthenticated === null) {
      wasAuthenticated = isAuthenticated;
      return;
    }
    if (isAuthenticated === wasAuthenticated) return;
    wasAuthenticated = isAuthenticated;
    targetStore.set(projectOrgRevisionAtom, (revision) => revision + 1);
  });

  return () => {
    unsubscribeOrgChanged();
    unsubscribeAuth();
  };
}
