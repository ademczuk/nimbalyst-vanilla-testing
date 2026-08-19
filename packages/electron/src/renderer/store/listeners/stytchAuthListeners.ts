/**
 * Central Stytch Auth State Listener
 *
 * Subscribes to `electronAPI.stytch.onAuthStateChange` ONCE at app startup
 * and writes the latest snapshot to `stytchAuthAtom`. Components read from
 * the atom and MUST NOT subscribe to the IPC event directly (see IPC_LISTENERS.md).
 *
 * Also performs the initial `getAuthState()` fetch so consumers can render
 * synchronously off the atom without each one re-fetching.
 *
 * Call initStytchAuthListeners() once in App.tsx on mount.
 */

import { store } from '@nimbalyst/runtime/store';
import { stytchAuthAtom, type StytchAuthSnapshot } from '../atoms/stytchAuth';
import {
  organizationDirectoryAtom,
  personalAccountsAtom,
  type OrganizationDirectoryEntry,
  type PersonalAccountSummary,
} from '../atoms/settingsDomains';
import { createPerKeyDebouncer } from '../listeners/perKeyDebounce';
import { bucketOrganizationCount } from '../../../shared/analytics/teamAnalytics';
import { trackTeamAnalyticsEvent } from '../../utils/teamAnalytics';

let initialized = false;

async function trackMembershipSignInCompleted(userId: string | null): Promise<void> {
  // The auth broadcast reaches every project window, so the sign-in has to be
  // attributed once. Main arbitrates (see SignInAttribution): sign-in completes
  // in an external browser, so gating on this window's focus dropped the event
  // whenever the app was still in the background -- and `document.hasFocus()`
  // is true in every window at once anyway, so it never deduplicated either.
  const claim = window.electronAPI?.team?.claimSignInAttribution;
  if (claim && await claim(userId ?? 'unknown-user') === false) return;
  const result = await window.electronAPI?.team?.list?.({ forceRefresh: true });
  if (!result?.success || !result.teams?.length) return;

  const hasActive = result.teams.some((team: { membershipType?: string }) => (
    !team.membershipType || team.membershipType === 'active_member'
  ));
  const hasPending = result.teams.some((team: { membershipType?: string }) => (
    !!team.membershipType && team.membershipType !== 'active_member'
  ));
  trackTeamAnalyticsEvent('team_sign_in_completed', {
    surface: 'desktop',
    membershipState: hasActive && hasPending ? 'mixed' : hasActive ? 'active' : 'pending',
    organizationCountBucket: bucketOrganizationCount(result.teams.length),
  });
}

export async function refreshPersonalAccountsDirectory(): Promise<PersonalAccountSummary[]> {
  const stytch = window.electronAPI?.stytch;
  if (!stytch) {
    store.set(personalAccountsAtom, []);
    return [];
  }
  try {
    const accounts = (await stytch.getAccounts() ?? []) as PersonalAccountSummary[];
    store.set(personalAccountsAtom, accounts);
    return accounts;
  } catch {
    store.set(personalAccountsAtom, []);
    return [];
  }
}

export function initStytchAuthListeners(): () => void {
  if (initialized) {
    return () => {};
  }
  initialized = true;

  const stytch = window.electronAPI?.stytch;
  if (!stytch) {
    return () => {
      initialized = false;
    };
  }

  const loadIdentityDirectory = async () => {
    await refreshPersonalAccountsDirectory();
    try {
      const result = await window.electronAPI?.team?.list?.();
      store.set(
        organizationDirectoryAtom,
        result?.success && Array.isArray(result.teams)
          ? result.teams as OrganizationDirectoryEntry[]
          : [],
      );
    } catch {
      store.set(organizationDirectoryAtom, []);
    }
  };

  // Coalesce event-driven refreshes. Auth-state-change and organizations-changed
  // can arrive in tight bursts (multi-window token churn); without debouncing,
  // each one fires its own team:list. See NIM-1828 -- this was a symptom-side
  // amplifier of the auth-state-change storm.
  const identityDirectoryDebouncer = createPerKeyDebouncer(400);
  const scheduleIdentityDirectoryReload = () => {
    identityDirectoryDebouncer.schedule('reload', () => { void loadIdentityDirectory(); });
  };

  // Initial fetch -- atom stays null until this resolves so the UI can
  // distinguish "still loading" from "loaded and signed out". Run it directly
  // (not debounced) so first paint isn't delayed.
  stytch.getAuthState()
    .then((state) => {
      store.set(stytchAuthAtom, {
        isAuthenticated: !!state?.isAuthenticated,
        user: state?.user ?? null,
      } satisfies StytchAuthSnapshot);
      void loadIdentityDirectory();
    })
    .catch(() => {
      // Treat fetch failure as signed-out rather than leaving the atom null
      // forever -- otherwise the UI never resolves out of its loading state.
      store.set(stytchAuthAtom, { isAuthenticated: false, user: null });
    });

  const unsubscribe = stytch.onAuthStateChange?.((state: { isAuthenticated?: boolean; user?: StytchAuthSnapshot['user'] }) => {
    const wasAuthenticated = store.get(stytchAuthAtom)?.isAuthenticated ?? false;
    const isAuthenticated = !!state?.isAuthenticated;
    store.set(stytchAuthAtom, {
      isAuthenticated,
      user: state?.user ?? null,
    });
    if (isAuthenticated && !wasAuthenticated) {
      void trackMembershipSignInCompleted(state?.user?.user_id ?? null).catch(() => {});
    }
    scheduleIdentityDirectoryReload();
  });

  void stytch.subscribeAuthState?.();
  const handleOrganizationsChanged = () => { scheduleIdentityDirectoryReload(); };
  window.addEventListener('nimbalyst:organizations-changed', handleOrganizationsChanged);

  return () => {
    initialized = false;
    identityDirectoryDebouncer.cancelAll();
    unsubscribe?.();
    window.removeEventListener('nimbalyst:organizations-changed', handleOrganizationsChanged);
  };
}
