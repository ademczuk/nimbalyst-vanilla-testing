/**
 * Which organization-sidebar sections the user has collapsed.
 *
 * Follows the tracker sidebar's rule (`trackerSidebarCollapsedSectionsAtom`):
 * collapse is a preference, not a mount detail, so folding Rooms away has to
 * survive a remount and a restart rather than springing back open the next time
 * the mode is entered.
 *
 * Storage is the app-settings store over IPC, never `localStorage` — the same
 * path `inboxPreferences.ts` and `defaultOrg.ts` already use. Reads and writes
 * are best-effort: failing to remember a fold must never block the sidebar.
 */

import { atom } from 'jotai';

export const ORG_SIDEBAR_PREFERENCES_SETTING_KEY = 'orgSidebarPreferences';

/**
 * The sidebar's groups. Ids, not labels: renaming "Direct messages" must not
 * silently un-collapse it for everyone who had folded it away.
 */
export type OrgSidebarSectionId = 'inbox' | 'rooms' | 'dms' | 'projects';

const SECTION_IDS: readonly OrgSidebarSectionId[] = [
  'inbox',
  'rooms',
  'dms',
  'projects',
];

export interface OrgSidebarPreferences {
  collapsedSections: OrgSidebarSectionId[];
}

export const DEFAULT_ORG_SIDEBAR_PREFERENCES: OrgSidebarPreferences = {
  collapsedSections: [],
};

/**
 * Stored state predates any section added later, and may name one that has since
 * been removed (STATE_PERSISTENCE.md). Unknown ids are dropped rather than
 * carried forward, so a stale entry cannot collapse a section that reuses the
 * name later.
 */
export function normalizeOrgSidebarPreferences(raw: unknown): OrgSidebarPreferences {
  const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const stored = Array.isArray(record.collapsedSections) ? record.collapsedSections : [];
  return {
    collapsedSections: stored.filter((entry): entry is OrgSidebarSectionId =>
      typeof entry === 'string' && SECTION_IDS.includes(entry as OrgSidebarSectionId)),
  };
}

export async function readOrgSidebarPreferences(): Promise<OrgSidebarPreferences> {
  try {
    const stored = await window.electronAPI?.invoke?.(
      'app-settings:get',
      ORG_SIDEBAR_PREFERENCES_SETTING_KEY,
    );
    return normalizeOrgSidebarPreferences(stored);
  } catch {
    return DEFAULT_ORG_SIDEBAR_PREFERENCES;
  }
}

export async function persistOrgSidebarPreferences(
  preferences: OrgSidebarPreferences,
): Promise<void> {
  try {
    await window.electronAPI?.invoke?.(
      'app-settings:set',
      ORG_SIDEBAR_PREFERENCES_SETTING_KEY,
      preferences,
    );
  } catch {
    // Best effort.
  }
}

/**
 * The collapsed set, shared by both surfaces. Deliberately not per-surface: the
 * standalone window and the project window's mode are the same sidebar, and a
 * user who folds Projects away means it in both.
 */
export const orgSidebarCollapsedSectionsAtom = atom<OrgSidebarSectionId[]>(
  DEFAULT_ORG_SIDEBAR_PREFERENCES.collapsedSections,
);

/** Per-store rather than module-level, so tests start from a clean slate. */
const orgSidebarPreferencesHydratedAtom = atom(false);
/** Set once the user folds something, which outranks a read still in flight. */
const orgSidebarSectionsTouchedAtom = atom(false);

/**
 * Fill the collapsed set from storage, once per store. Both surfaces call this
 * on mount; the flag is set before the read so the second caller does not issue
 * a duplicate IPC round trip.
 *
 * A fold made while the read was in flight wins: the stored value is what the
 * user left behind last time, and it must not undo what they just did.
 */
export const hydrateOrgSidebarPreferencesAtom = atom(
  null,
  async (get, set) => {
    if (get(orgSidebarPreferencesHydratedAtom)) return;
    set(orgSidebarPreferencesHydratedAtom, true);
    const preferences = await readOrgSidebarPreferences();
    if (get(orgSidebarSectionsTouchedAtom)) return;
    set(orgSidebarCollapsedSectionsAtom, preferences.collapsedSections);
  },
);

/** Fold a section away, or open it, and remember which. */
export const toggleOrgSidebarSectionAtom = atom(
  null,
  (get, set, sectionId: OrgSidebarSectionId) => {
    set(orgSidebarSectionsTouchedAtom, true);
    const collapsed = get(orgSidebarCollapsedSectionsAtom);
    const next = collapsed.includes(sectionId)
      ? collapsed.filter((entry) => entry !== sectionId)
      : [...collapsed, sectionId];
    set(orgSidebarCollapsedSectionsAtom, next);
    void persistOrgSidebarPreferences({ collapsedSections: next });
  },
);
