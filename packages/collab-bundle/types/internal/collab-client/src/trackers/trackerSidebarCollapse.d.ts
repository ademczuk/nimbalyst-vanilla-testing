import type { TrackerOwnership } from './trackerNavigationTree';
/**
 * Normalizers for the tracker sidebar's persisted collapse state. Workspace
 * state written by older builds carries neither key, and state written by a
 * newer build could carry values this build doesn't know — both must load as
 * a sane default rather than throw or leak junk into the UI.
 */
export declare function normalizeCollapsedOwnershipSections(raw: unknown): TrackerOwnership[];
export declare function normalizeExpandedNavFolders(raw: unknown): string[];
/** The list with `entry` present or absent, order of the rest preserved. */
export declare function toggleListEntry<T>(list: readonly T[], entry: T, present: boolean): T[];
