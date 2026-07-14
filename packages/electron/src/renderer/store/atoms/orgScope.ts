/**
 * Selected-org state for the Organization settings scope (Epic H3 P3).
 *
 * The settings header has four scopes -- Application | Personal |
 * Organizations | Project. The
 * Organization scope is keyed to the org the user picked in the `OrgSwitcher`
 * (above the project rail), NOT to the active workspace. This atom is the single
 * shared source of that selection so the switcher and the settings shell agree.
 *
 * `null` means no organization is selected. It is unrelated to the selected
 * personal/mobile sync account.
 */

import { atom } from 'jotai';

/** The org id currently selected for org-scoped settings, or null for none. */
export const selectedOrgIdAtom = atom<string | null>(null);
