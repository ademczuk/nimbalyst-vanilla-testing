/**
 * Central listener for the post-sign-in project walk.
 *
 * Sign-in is the moment the dead end appears: the account gains an organization
 * while the open folder still matches nothing, so every org surface reports "No
 * organization". `stytch:auth-state-changed` is broadcast to every window and is
 * already mirrored into `stytchAuthAtom`, so this subscribes to that atom rather
 * than adding a second IPC listener for the same event (IPC_LISTENERS.md). The
 * console deep-link handoff lands in `deepLinkListeners`, which asks for a
 * refresh through `orgProjectWalkRefreshAtom`.
 *
 * See nimbalyst-local/plans/simpler-org-signup-flow.md (Item 3).
 */

import type { Store } from 'jotai/vanilla/store';

// The store singleton, not the `store/index` barrel, which would drag every
// renderer atom module in behind it.
import { store } from '@nimbalyst/runtime/store';
import { resolveProjectWalkPresentation } from '../../../shared/orgProjectWalk';
import { dialogRef } from '../../contexts/DialogContext';
import { DIALOG_IDS } from '../../dialogs/registry';
import { readOrgProjectWalkDismissals } from '../../components/TeamMode/onboarding/orgOnboardingStorage';
import type { ProjectWalkOutcome } from '../../components/TeamMode/onboarding/OrgProjectWalkDialog';
import { trackTeamAnalyticsEvent } from '../../utils/teamAnalytics';
import {
  orgProjectCloneProgressAtom,
  orgProjectWalkAtom,
  orgProjectWalkRefreshAtom,
} from '../atoms/orgProjectWalk';
import { projectOrgRevisionAtom } from '../atoms/orgScope';
import { stytchAuthAtom } from '../atoms/stytchAuth';
import { windowFocusedAtom } from '../atoms/windowFocus';

/**
 * Named seam for "project walk presented". A sibling session wires the funnel
 * event; keeping the call site here means it lands in one place rather than
 * being reconstructed from dialog-open bookkeeping.
 */
export function onProjectWalkPresented(_org: { orgId: string; name: string }): void {
  trackTeamAnalyticsEvent('team_project_walk_presented', {
    surface: 'desktop',
  });
}

/**
 * Named seam for "project walk completed". The outcome carries how the folder
 * was obtained (clone or bind) and whether the walk was skipped instead.
 */
export function onProjectWalkFinished(
  _org: { orgId: string; name: string },
  _outcome: ProjectWalkOutcome,
): void {
  trackTeamAnalyticsEvent('team_project_walk_completed', {
    surface: 'desktop',
    folderSource: _outcome.completed ? _outcome.folderSource : 'not_applicable',
    skipped: !_outcome.completed && _outcome.skipped,
  });
}

/**
 * Open the walk from a persistent entry point ("Join {Org} project"), for
 * someone who dismissed it or signed in before it existed.
 */
export function openOrgProjectWalk(targetStore: Store = store): void {
  const [org] = targetStore.get(orgProjectWalkAtom).enterableOrgs;
  if (!org) return;
  presentWalk(org, targetStore);
}

/**
 * Open the walk for a named organization.
 *
 * Settings lists every membership, so the org is already chosen by the row the
 * user clicked; nothing here has to guess which of them they meant.
 */
export function openOrgProjectWalkFor(
  org: { orgId: string; name: string },
  targetStore: Store = store,
): void {
  presentWalk(org, targetStore);
}

function presentWalk(org: { orgId: string; name: string }, targetStore: Store): void {
  onProjectWalkPresented(org);
  dialogRef.current?.open(DIALOG_IDS.ORG_PROJECT_WALK, {
    org,
    onFinished: (outcome: ProjectWalkOutcome) => {
      onProjectWalkFinished(org, outcome);
      // Re-resolve: a bound folder retires the entry point, a skip does not.
      targetStore.set(orgProjectWalkRefreshAtom, (revision) => revision + 1);
    },
  });
}

export function initOrgProjectWalkListeners(targetStore: Store = store): () => void {
  let disposed = false;
  let inFlight: Promise<void> | null = null;
  /** A walk that was due while this window could not show it. */
  let deferred = false;

  const present = async (org: { orgId: string; name: string }): Promise<void> => {
    if (!dialogRef.current) {
      deferred = true;
      return;
    }
    if (dialogRef.current.isOpen(DIALOG_IDS.ORG_PROJECT_WALK)) return;

    // Every project window receives the auth broadcast, so exactly one may act
    // on it. Focus cannot pick that one: sign-in finishes in an external
    // browser, so at that moment NO window is key and every window declines --
    // which is why the walk used to arrive whenever the user next happened to
    // focus the app, long after they had given up looking for a way in. Main
    // sees all the windows, so it arbitrates and prefers the window the
    // sign-in was started from.
    const granted = await window.electronAPI?.team?.claimProjectWalk?.(
      `project-walk:${org.orgId}`,
    );
    if (disposed) return;
    if (!granted) {
      // Not a dropped walk: the window that won may have been closed before it
      // could present, and after the originator's grace period any window may
      // claim. A later focus retries.
      deferred = true;
      return;
    }
    deferred = false;
    presentWalk(org, targetStore);
  };

  const resolve = async (): Promise<void> => {
    const auth = targetStore.get(stytchAuthAtom);
    if (!auth?.isAuthenticated) {
      targetStore.set(orgProjectWalkAtom, { enterableOrgs: [], autoPresentOrg: null });
      return;
    }
    const state = await window.electronAPI?.team?.resolveProjectWalk?.();
    if (disposed) return;
    if (!state?.success) {
      // A failed lookup is not evidence of "no organization"; leaving the last
      // answer in place keeps the entry point from flickering away offline.
      return;
    }
    const presentation = resolveProjectWalkPresentation({
      orgs: state.orgs ?? [],
      boundOrgIds: state.boundOrgIds ?? [],
      thisWindowOrgId: state.thisWindowOrgId ?? null,
      dismissedOrgIds: await readOrgProjectWalkDismissals(),
    });
    if (disposed) return;
    targetStore.set(orgProjectWalkAtom, presentation);

    // Deliberately not closing an open walk when the org goes away: the
    // dialog's own success step is what removes it, and closing it there would
    // snatch the confirmation away as it appeared.
    if (presentation.autoPresentOrg) await present(presentation.autoPresentOrg);
    // Nothing left to hold, so focus changes stop costing a re-resolve.
    else deferred = false;
  };

  const schedule = () => {
    // Serialize: auth-state and org-directory changes arrive in bursts, and
    // each resolve costs a git spawn per open workspace.
    inFlight = (inFlight ?? Promise.resolve())
      .then(() => resolve())
      .catch(() => {});
  };

  const unsubscribers = [
    targetStore.sub(stytchAuthAtom, schedule),
    targetStore.sub(orgProjectWalkRefreshAtom, schedule),
    // A workspace's org changed, so what counts as bound just changed too.
    targetStore.sub(projectOrgRevisionAtom, schedule),
    // This window became the one that can show a held-back walk.
    targetStore.sub(windowFocusedAtom, () => {
      if (!deferred || !targetStore.get(windowFocusedAtom)) return;
      schedule();
    }),
  ];

  // Clone progress is a push stream, so it does need its own IPC subscription;
  // it lands in an atom like every other one (IPC_LISTENERS.md).
  const unsubscribeCloneProgress = window.electronAPI?.team?.onProjectCloneProgress?.(
    (progress: { cloneId: string; phase: string; percent: number | null }) => {
      targetStore.set(orgProjectCloneProgressAtom, progress);
    },
  );
  if (unsubscribeCloneProgress) unsubscribers.push(unsubscribeCloneProgress);

  const onOrganizationsChanged = () => schedule();
  window.addEventListener('nimbalyst:organizations-changed', onOrganizationsChanged);

  schedule();

  return () => {
    disposed = true;
    for (const unsubscribe of unsubscribers) unsubscribe();
    window.removeEventListener('nimbalyst:organizations-changed', onOrganizationsChanged);
  };
}
