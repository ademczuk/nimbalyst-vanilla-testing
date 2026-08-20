import React, { useEffect, useMemo, useState } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import { useAtomValue, useSetAtom } from 'jotai';

import { SidebarSection } from '../common/SidebarSection';
import { OrgSidebarHeader } from './OrgSidebarHeader';
import {
  OrgConversationRow,
  OrgDirectoryLoadError,
  OrgInboxNavRow,
  OrgSidebarSectionNote,
} from './OrgSidebarRows';
import { OrgSidebarSectionAdd } from './OrgSidebarSectionMenu';
import {
  hydrateOrgSidebarPreferencesAtom,
  orgSidebarCollapsedSectionsAtom,
  toggleOrgSidebarSectionAtom,
  type OrgSidebarSectionId,
} from './orgSidebarPreferences';
import type { InboxFilterId } from './Inbox/inboxTypes';
import { INBOX_FILTERS } from './Inbox/inboxViewModel';
import type { OrgModeChrome } from './orgModeTypes';
import type { OrgSidebarModel } from './orgSidebarViewModel';
import { filterOrgSidebarModel, matchesOrgSidebarQuery } from './orgSidebarViewModel';
import type { OrgWindowRoute } from './orgWindowState';
import {
  DIRECTORY_ROUTE,
  ORG_WINDOW_SURFACE_ID,
} from './orgWindowState';

/**
 * The organization's navigation column, in both surfaces: the standalone window
 * and Org mode inside a project window.
 *
 * Shaped like every other mode's sidebar — org summary header, one search field,
 * then collapsible sections over a pinned identity footer — rather than the
 * bespoke column the window used to carry. Collapse survives a remount
 * (`orgSidebarPreferences`); collapsing the whole column is the gutter's job,
 * and the host simply stops rendering this.
 *
 * The Admin group it used to end with is gone: administration is the
 * `ORG_MANAGEMENT` dialog, reached from the profile menu in the footer below
 * rather than from a row here (Greg, NIM-2322: the sidebar stays messaging).
 *
 * Memoized, and deliberately not given the active route: a navigation must not
 * repaint the whole column. Each row subscribes to its own
 * `orgWindowRouteSelectedAtomFamily` entry instead, so moving between two
 * destinations re-renders exactly the two rows whose selection flipped. Keep
 * every prop here stable in the host, or the memo is decorative.
 */
export const OrgSidebar = React.memo(function OrgSidebar({
  surfaceId = ORG_WINDOW_SURFACE_ID,
  chrome = 'mode',
  orgId,
  orgName,
  model,
  directoryLoading = false,
  directoryError,
  onRetryDirectory,
  onNavigate,
  onCreateRoom,
  onCreateDirectMessage,
  projectsContent,
  bottomContent,
}: {
  surfaceId?: string;
  /** The window draws its own title bar and rail; the mode draws neither. */
  chrome?: OrgModeChrome;
  /** Scopes the Inbox rows' counts; absent on a surface with no organization. */
  orgId?: string;
  orgName?: string;
  model: OrgSidebarModel;
  directoryLoading?: boolean;
  /**
   * Set when the last directory read failed. An empty list then means "we do
   * not know", not "there is nothing here" — the empty-state copy would tell a
   * member to create a room the organization may already have.
   */
  directoryError?: string | null;
  onRetryDirectory?: () => void;
  onNavigate: (route: OrgWindowRoute) => void;
  /**
   * Absent when this viewer may not create the kind — the control renders
   * disabled with the reason rather than silently doing nothing when clicked.
   */
  onCreateRoom?: () => void;
  onCreateDirectMessage?: () => void;
  /**
   * The Projects section, scrolling with the rest of the sidebar below the
   * conversation sections. Passed in rather than built here because it reads
   * main-process project state this component knows nothing about.
   */
  projectsContent?: React.ReactNode;
  /** Pinned footer below the scrolling sections — the signed-in identity. */
  bottomContent?: React.ReactNode;
}) {
  // Presentation gating only: an organization that turned rooms or DMs off
  // loses the sections, and the server rejects the disabled kinds regardless.
  const { gating } = model;
  const [query, setQuery] = useState('');
  const searching = query.trim().length > 0;
  const filtered = useMemo(() => filterOrgSidebarModel(model, query), [model, query]);

  const collapsedSections = useAtomValue(orgSidebarCollapsedSectionsAtom);
  const toggleSection = useSetAtom(toggleOrgSidebarSectionAtom);
  const hydratePreferences = useSetAtom(hydrateOrgSidebarPreferencesAtom);
  useEffect(() => { void hydratePreferences(); }, [hydratePreferences]);
  // A search reaches into folded sections rather than pretending they are empty,
  // and does it without disturbing what the user chose to keep folded.
  const isCollapsed = (sectionId: OrgSidebarSectionId) =>
    !searching && collapsedSections.includes(sectionId);

  const inboxRows = INBOX_NAV_ROWS.filter((row) => matchesOrgSidebarQuery(row.label, query));

  return (
    <nav
      className={`org-sidebar flex w-[248px] shrink-0 flex-col overflow-hidden border-r border-nim bg-nim-secondary ${
        chrome === 'window' ? 'org-window-drag-region' : ''
      }`}
      data-testid="org-sidebar"
      data-component="OrgSidebar"
      data-window-drag-region={chrome === 'window' ? 'true' : undefined}
      aria-label="Organization"
    >
      <OrgSidebarHeader orgId={orgId} orgName={orgName} chrome={chrome} />

      {/* One field over the whole column. Message bodies are the Inbox's own
          search — this one matches what is on screen here. */}
      <div className="org-sidebar-search shrink-0 px-2.5 py-2">
        <div className="flex items-center gap-2 rounded-md border border-nim bg-nim px-2 py-1 focus-within:border-nim-focus">
          <MaterialSymbol icon="search" size={14} className="shrink-0 text-nim-faint" />
          <input
            type="text"
            value={query}
            data-testid="org-sidebar-search-input"
            aria-label="Search conversations"
            placeholder="Search conversations"
            className="org-sidebar-search-input org-window-no-drag min-w-0 flex-1 select-text border-none bg-transparent text-[12px] text-nim outline-none placeholder:text-nim-faint"
            onChange={(event) => setQuery(event.target.value)}
          />
          {searching && (
            <button
              type="button"
              className="org-sidebar-search-clear org-window-no-drag shrink-0 rounded p-0.5 text-nim-faint hover:bg-nim-hover hover:text-nim"
              data-testid="org-sidebar-search-clear"
              aria-label="Clear search"
              onClick={() => setQuery('')}
            >
              <MaterialSymbol icon="close" size={12} />
            </button>
          )}
        </div>
      </div>

      <div className="org-sidebar-scroll min-h-0 flex-1 overflow-y-auto pb-2">
        <SidebarSection
          sectionId="inbox"
          title="Inbox"
          testId="org-inbox-section"
          collapsed={isCollapsed('inbox')}
          onToggleCollapsed={() => toggleSection('inbox')}
        >
          {inboxRows.map((row) => (
            <OrgInboxNavRow
              key={row.id}
              surfaceId={surfaceId}
              orgId={orgId}
              filter={row.id}
              testId={row.testId}
              icon={row.icon}
              label={row.label}
              onNavigate={onNavigate}
            />
          ))}
        </SidebarSection>

        {gating.roomsVisible && (
          <SidebarSection
            sectionId="rooms"
            title="Rooms"
            testId="org-rooms-section"
            collapsed={isCollapsed('rooms')}
            onToggleCollapsed={() => toggleSection('rooms')}
            actions={
              /* The directory used to have its own row under the list. It is a
                 rare, one-off action, so it lives in the section's + menu next
                 to the create it belongs with rather than costing a row. */
              <OrgSidebarSectionAdd
                surfaceId={surfaceId}
                testId="org-rooms-section"
                addLabel="Room actions"
                menuItems={[
                  {
                    testId: 'org-create-room',
                    label: 'New room',
                    icon: 'add',
                    onSelect: gating.canCreateRoom ? onCreateRoom : undefined,
                    disabledLabel: 'Only organization admins can create rooms',
                  },
                  {
                    testId: 'org-browse-rooms',
                    label: 'Browse rooms',
                    icon: 'search',
                    // The menu only exists while it is open, so reading the
                    // route here costs nothing between openings.
                    routeKey: 'directory',
                    onSelect: () => onNavigate(DIRECTORY_ROUTE),
                  },
                ]}
              />
            }
          >
            {filtered.rooms.map((item) => (
              <OrgConversationRow
                key={item.conversationId}
                surfaceId={surfaceId}
                item={item}
                onNavigate={onNavigate}
              />
            ))}
            {directoryError
              ? (
                <OrgDirectoryLoadError
                  subject="rooms"
                  testId="org-rooms-error"
                  onRetry={onRetryDirectory}
                />
              )
              : filtered.rooms.length === 0 && (
                <OrgSidebarSectionNote testId="org-rooms-empty" className="org-rooms-empty">
                  {searching
                    ? 'No rooms match that search.'
                    : directoryLoading
                      ? 'Loading rooms…'
                      : gating.canCreateRoom
                        ? 'No rooms yet. Create one with + or browse the directory.'
                        : 'No rooms yet. Use + to browse the directory for one to join.'}
                </OrgSidebarSectionNote>
              )}
          </SidebarSection>
        )}

        {gating.dmsVisible && (
          <SidebarSection
            sectionId="dms"
            title="Direct messages"
            testId="org-dms-section"
            collapsed={isCollapsed('dms')}
            onToggleCollapsed={() => toggleSection('dms')}
            actions={
              <OrgSidebarSectionAdd
                surfaceId={surfaceId}
                testId="org-dms-section"
                addLabel="New direct message"
                onAdd={onCreateDirectMessage}
              />
            }
          >
            {filtered.dms.map((item) => (
              <OrgConversationRow
                key={item.conversationId}
                surfaceId={surfaceId}
                item={item}
                onNavigate={onNavigate}
              />
            ))}
            {directoryError
              ? (
                <OrgDirectoryLoadError
                  subject="direct messages"
                  testId="org-dms-error"
                  onRetry={onRetryDirectory}
                />
              )
              : filtered.dms.length === 0 && (
                <OrgSidebarSectionNote testId="org-dms-empty" className="org-dms-empty">
                  {searching
                    ? 'No direct messages match that search.'
                    : gating.canCreateDirectMessage
                      ? 'No direct messages yet. Start one with +.'
                      : 'No direct messages yet.'}
                </OrgSidebarSectionNote>
              )}
          </SidebarSection>
        )}

        {projectsContent}
      </div>
      {bottomContent}
    </nav>
  );
});

/**
 * The Inbox section's rows: the reason axis, promoted out of the list's filter
 * chips so a row and the list it drives cannot disagree.
 *
 * Derived from `INBOX_FILTERS` rather than restated, so the nav and the
 * predicate that fills it can only ever list the same six things.
 */
const INBOX_NAV_ICONS: Record<InboxFilterId, string> = {
  all: 'inbox',
  mentions: 'alternate_email',
  assigned: 'assignment_ind',
  // Same glyph the feedback-request source identity uses on the row itself.
  awaiting: 'ballot',
  follows: 'visibility',
  archived: 'archive',
};

const INBOX_NAV_ROWS = INBOX_FILTERS.map(({ id, label }) => ({
  id,
  label,
  icon: INBOX_NAV_ICONS[id],
  // All keeps the historical marker: it is the Inbox landing row, and help
  // content and existing coverage are keyed on it.
  testId: id === 'all' ? 'team-tab-inbox' : `org-inbox-${id}`,
}));
