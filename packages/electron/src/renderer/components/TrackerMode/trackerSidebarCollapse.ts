import type { TrackerOwnership } from './trackerNavigationTree';

/**
 * Normalizers for the tracker sidebar's persisted collapse state. Workspace
 * state written by older builds carries neither key, and state written by a
 * newer build could carry values this build doesn't know — both must load as
 * a sane default rather than throw or leak junk into the UI.
 */

export function normalizeCollapsedOwnershipSections(raw: unknown): TrackerOwnership[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((value): value is TrackerOwnership => value === 'personal' || value === 'team'))];
}

export function normalizeExpandedNavFolders(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((value): value is string => typeof value === 'string'))];
}

/** The list with `entry` present or absent, order of the rest preserved. */
export function toggleListEntry<T>(list: readonly T[], entry: T, present: boolean): T[] {
  const without = list.filter((value) => value !== entry);
  return present ? [...without, entry] : without;
}
