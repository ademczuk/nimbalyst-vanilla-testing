/**
 * app-settings access for org onboarding state.
 *
 * Renderer state never goes to localStorage (see packages/electron/CLAUDE.md);
 * these two keys ride the generic `app-settings:get|set` channel the org window
 * already uses for its last-selected org.
 */

import {
  ORG_WELCOME_DISMISSED_SETTING_KEY,
  ORG_WINDOW_PENDING_ROUTE_SETTING_KEY,
  parseDismissedOrgIds,
  parsePendingRoute,
  pendingGeneralRoute,
  withDismissedOrgId,
  type OrgWindowPendingRoute,
} from './orgWelcomeModel';
import {
  draftOwnerMatches,
  rehydrateOrgWizardDraft,
  serializeOrgWizardDraft,
  type OrgWizardState,
} from './orgWizardModel';
import { ORG_PROJECT_WALK_DISMISSED_SETTING_KEY } from '../../../../shared/orgProjectWalk';

export const ORG_WIZARD_DRAFT_SETTING_KEY = 'orgWizardDraft';

/**
 * Organizations whose post-sign-in project walk the user has closed. Dismissal
 * only silences the dialog; the "Join {Org} project" entry point stays. Main
 * clears this on sign-out, so the key itself is declared in the shared module.
 */
export { ORG_PROJECT_WALK_DISMISSED_SETTING_KEY };

async function readSetting(key: string): Promise<unknown> {
  try {
    return await window.electronAPI?.invoke?.('app-settings:get', key);
  } catch {
    // A missing or unreadable setting is indistinguishable from "not set yet",
    // and onboarding must never block on it.
    return undefined;
  }
}

async function writeSetting(key: string, value: unknown): Promise<boolean> {
  try {
    if (!window.electronAPI?.invoke) return false;
    await window.electronAPI.invoke('app-settings:set', key, value);
    return true;
  } catch {
    // Callers keep the in-memory state usable and retry the durable hand-off.
    return false;
  }
}

export async function readOrgWelcomeDismissed(orgId: string): Promise<boolean> {
  const stored = await readSetting(ORG_WELCOME_DISMISSED_SETTING_KEY);
  return parseDismissedOrgIds(stored).includes(orgId);
}

export async function markOrgWelcomeDismissed(orgId: string): Promise<void> {
  const stored = await readSetting(ORG_WELCOME_DISMISSED_SETTING_KEY);
  await writeSetting(
    ORG_WELCOME_DISMISSED_SETTING_KEY,
    withDismissedOrgId(stored, orgId),
  );
}

export async function readOrgProjectWalkDismissals(): Promise<string[]> {
  return parseDismissedOrgIds(await readSetting(ORG_PROJECT_WALK_DISMISSED_SETTING_KEY));
}

export async function markOrgProjectWalkDismissed(orgId: string): Promise<void> {
  const stored = await readSetting(ORG_PROJECT_WALK_DISMISSED_SETTING_KEY);
  await writeSetting(
    ORG_PROJECT_WALK_DISMISSED_SETTING_KEY,
    withDismissedOrgId(stored, orgId),
  );
}

/**
 * Queue where the org window should land once it opens (or is retargeted).
 * The creation wizard separately dismisses its welcome card; invited members
 * leave that dismissal unset so #general can show it on first open.
 */
export async function queueOrgWindowGeneralRoute(orgId: string): Promise<boolean> {
  return writeSetting(
    ORG_WINDOW_PENDING_ROUTE_SETTING_KEY,
    pendingGeneralRoute(orgId),
  );
}

export async function persistOrgWizardDraft(state: OrgWizardState): Promise<boolean> {
  return writeSetting(ORG_WIZARD_DRAFT_SETTING_KEY, serializeOrgWizardDraft(state));
}

/**
 * The draft for `currentOwner` (null while signed out), or nothing.
 *
 * One machine can host several accounts, and the draft key is global: a draft
 * stamped with another identity is not this user's to resume, so it is dropped
 * rather than shown — its org name and invite list are the other user's.
 */
export async function readOrgWizardDraft(
  currentOwner: string | null,
): Promise<OrgWizardState | null> {
  const state = rehydrateOrgWizardDraft(await readSetting(ORG_WIZARD_DRAFT_SETTING_KEY));
  if (!state) return null;
  if (!draftOwnerMatches(state.owner, currentOwner)) {
    await clearOrgWizardDraft();
    return null;
  }
  return state;
}

export async function clearOrgWizardDraft(): Promise<boolean> {
  return writeSetting(ORG_WIZARD_DRAFT_SETTING_KEY, null);
}

export async function readOrgWindowPendingRoute(): Promise<unknown> {
  return readSetting(ORG_WINDOW_PENDING_ROUTE_SETTING_KEY);
}

/**
 * Clear only the destination this window has actually reached.
 *
 * Reading immediately before the write prevents a delayed acknowledgement
 * from erasing a newer hand-off for another organization.
 */
export async function acknowledgeOrgWindowPendingRoute(
  orgId: string,
  conversationId: string,
): Promise<boolean> {
  const pending = parsePendingRoute(
    await readSetting(ORG_WINDOW_PENDING_ROUTE_SETTING_KEY),
  );
  if (
    !pending
    || pending.orgId !== orgId
    || pending.conversationId !== conversationId
  ) {
    return false;
  }
  return writeSetting(ORG_WINDOW_PENDING_ROUTE_SETTING_KEY, null);
}

export type { OrgWindowPendingRoute };
