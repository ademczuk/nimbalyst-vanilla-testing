/**
 * State for the post-sign-in project walk.
 *
 * `enterableOrgs` is every organization the account belongs to that this window
 * is not already in. It is what the persistent "Join {Org} project" entry point
 * reads, and it survives a dismissal — dismissing only clears `autoPresentOrg`.
 *
 * Written by `orgProjectWalkListeners`; components only read.
 */

import { atom } from 'jotai';

import type { ProjectWalkPresentation } from '../../../shared/orgProjectWalk';

export const orgProjectWalkAtom = atom<ProjectWalkPresentation>({
  enterableOrgs: [],
  autoPresentOrg: null,
});

/** Bumped to ask the listener to re-resolve (e.g. after the walk finishes). */
export const orgProjectWalkRefreshAtom = atom(0);

/**
 * Latest progress for a running clone, keyed by the clone the walk started.
 * Written by `orgProjectWalkListeners`; the dialog filters on its own id, so a
 * clone left running in the background can't drive another dialog's bar.
 */
export const orgProjectCloneProgressAtom = atom<{
  cloneId: string;
  phase: string;
  percent: number | null;
} | null>(null);
