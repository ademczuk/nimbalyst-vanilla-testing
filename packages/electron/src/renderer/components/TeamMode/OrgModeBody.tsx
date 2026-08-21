import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TrackerItem } from '@nimbalyst/runtime/core/DocumentService';
import { trackerItemToRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import { replaceOrgTrackerItemsAtom } from '@nimbalyst/runtime/plugins/TrackerPlugin/trackerDataAtoms';
import { useAtomValue, useStore } from 'jotai';

import {
  conversationDirectoryAtomFamily,
  conversationDirectoryLoadStateAtomFamily,
  conversationMembershipsByIdAtomFamily,
  conversationParticipantsByIdAtomFamily,
} from '../../store/atoms/conversations';
import {
  orgPresenceAtomFamily,
  orgUnreadCountsByConversationAtomFamily,
} from '../../store/atoms/teamInbox';
import {
  refreshConversationDirectory,
  refreshConversationMembers,
} from '../../store/listeners/conversationDirectoryListeners';
import { orgSettingsAtomFamily } from '../../store/atoms/orgSettings';
import { initOrgWindowFreshnessListeners } from '../../store/listeners/orgWindowFreshnessListeners';
import { OrgWindowStatusBar } from './OrgWindowStatusBar';
import { OrgSidebar } from './OrgSidebar';
import { OrgRail } from './OrgRail';
import { OrgUserIndicator } from './OrgUserIndicator';
import {
  OrgProjectsSidebarSection,
  resolveConversationProjectWorkspace,
  useOrgProjectLocalStates,
} from './OrgProjectsSidebarSection';
import { OrgWelcomeBanner } from './onboarding/OrgWelcomeBanner';
import { isGeneralRoomId } from './onboarding/orgWelcomeModel';
import { RoomView } from './RoomView';
import { RoomsDirectory } from './RoomsDirectory';
import { OrgWindowCommandBridge } from './OrgWindowCommandBridge';
import { OrgWindowMarkReadOnOpen } from './OrgWindowMarkReadOnOpen';
import { OrgWindowTitleBar } from './OrgWindowTitleBar';
import { useOrgModeDialogs } from './OrgModeDialogs';
import { useOrgModeRoute } from './useOrgModeRoute';
import { InboxSection } from './Inbox';
import { InboxProviderContext, useInboxProvider } from './Inbox/inboxProvider';
import { buildOrgSidebar, isOrgAdminRole } from './orgSidebarViewModel';
import { shouldRenderOrgRail } from './orgWindowRailViewModel';
import { DIRECTORY_ROUTE, conversationRoute, withOrgWindowRouting } from './orgWindowState';
import { useOrgRoster } from './useOrgRoster';
import type { OrgModeChrome, TeamSummary } from './orgModeTypes';
import { CONSOLE_ORIGIN } from '../../../shared/consoleOrigin';

/**
 * The bound organization surface: messaging sidebar plus one main surface.
 *
 * Messaging is all of it since NIM-2322 — administration is the
 * `ORG_MANAGEMENT` dialog, which opens in whichever window the user is already
 * in, this one included.
 *
 * Split out because the org-scoped hooks below (directory,
 * roster, unread derivation) only make sense once an organization is resolved —
 * the unbound and loading arms in the host must not run them.
 */
export function OrgModeBody({
  team,
  organizations,
  boundEmail,
  workspacePath,
  surfaceId,
  chrome,
  sidebarCollapsed = false,
  onSelectOrganization,
}: {
  team: TeamSummary;
  organizations: TeamSummary[];
  boundEmail: string | null;
  workspacePath?: string;
  surfaceId: string;
  chrome: OrgModeChrome;
  /** Driven by re-clicking the gutter icon; the standalone window never sets it. */
  sidebarCollapsed?: boolean;
  onSelectOrganization: (orgId: string) => void;
}) {
  const orgId = team.orgId;
  const trackerStore = useStore();
  const conversations = useAtomValue(conversationDirectoryAtomFamily(orgId));
  const directoryLoadState = useAtomValue(conversationDirectoryLoadStateAtomFamily(orgId));
  const participantsByConversationId = useAtomValue(
    conversationParticipantsByIdAtomFamily(orgId),
  );
  const membershipsByConversationId = useAtomValue(
    conversationMembershipsByIdAtomFamily(orgId),
  );
  // Deliberately not the whole snapshot: it is replaced whenever any authorized
  // organization moves, including presence heartbeats and this window's own
  // mark-read receipts. These three selectors keep their identity when this
  // organization's slice did not change, so unrelated traffic no longer
  // rebuilds the sidebar model or re-renders the body.
  const unreadCounts = useAtomValue(
    orgUnreadCountsByConversationAtomFamily(orgId),
  );
  const presenceByMemberId = useAtomValue(orgPresenceAtomFamily(orgId));
  const settings = useAtomValue(orgSettingsAtomFamily(orgId));
  const roster = useOrgRoster(orgId);
  const baseInboxProvider = useInboxProvider();
  const projectLocalState = useOrgProjectLocalStates(orgId);
  const showOrgRail = chrome === 'window' && shouldRenderOrgRail(organizations);
  const openWebConsole = useCallback(() => {
    window.electronAPI.openExternal(CONSOLE_ORIGIN);
  }, []);
  const openProjectWorkspace = useCallback((workspacePath: string) => {
    void window.electronAPI.team.openProjectWorkspace(workspacePath).catch((reason) => {
      console.error('[TeamMode] Failed to open project workspace:', reason);
    });
  }, []);

  useEffect(() => {
    return initOrgWindowFreshnessListeners({
      getOrgId: () => orgId,
    });
  }, [orgId]);

  const isOrgAdmin = isOrgAdminRole(roster.callerRole);
  const sidebar = useMemo(() => buildOrgSidebar({
    conversations,
    settings,
    isOrgAdmin,
    unreadCounts,
    dmParticipants: participantsByConversationId,
    memberNames: roster.memberNames,
    viewerUserId: roster.viewerUserId ?? undefined,
    presenceByMemberId,
  }), [
    conversations,
    isOrgAdmin,
    participantsByConversationId,
    presenceByMemberId,
    roster.memberNames,
    roster.viewerUserId,
    settings,
    unreadCounts,
  ]);
  const gating = sidebar.gating;

  const { route, onRoute, routedConversation } = useOrgModeRoute({
    surfaceId,
    orgId,
    gating,
    conversations,
    directoryLoadState,
  });

  const inboxProvider = useMemo(
    () => withOrgWindowRouting(baseInboxProvider, orgId, onRoute),
    [baseInboxProvider, onRoute, orgId],
  );

  const activeConversation = routedConversation.entry;
  const activeConversationId = activeConversation?.id;
  const activeConversationProjectWorkspace = activeConversation
    ? resolveConversationProjectWorkspace(projectLocalState.projects, activeConversation)
    : null;

  const activeMemberships = activeConversationId
    ? membershipsByConversationId[activeConversationId]
    : undefined;

  // The Inbox is built once and then kept, so hopping between it and a room is
  // a visibility change rather than a rebuild. It is not mounted before it has
  // been visited: a window that opens straight into a room should not pay for a
  // surface nobody asked for.
  const [inboxMounted, setInboxMounted] = useState(route.view === 'inbox');
  useEffect(() => {
    if (route.view === 'inbox') setInboxMounted(true);
  }, [route.view]);

  useEffect(() => {
    if (chrome !== 'window') return;
    window.electronAPI?.send?.('team-window:route-state', {
      orgId,
      view: route.view,
      ...(route.view === 'conversation' && activeConversationId
        ? { conversationId: activeConversationId }
        : {}),
    });
  }, [activeConversationId, chrome, orgId, route.view]);

  // Into this org's own slice, never the workspace map. Whenever this body is a
  // mode rather than a window it shares one store with tracker mode, and it
  // stays mounted while hidden, so seeding the workspace map from here emptied
  // every tracker surface at startup (#3637). Chips fall back to the slice.
  useEffect(() => {
    let cancelled = false;
    void window.electronAPI.invoke(
      'team-window:tracker-items-list',
      { orgId },
    ).then((items: TrackerItem[]) => {
      if (cancelled) return;
      trackerStore.set(replaceOrgTrackerItemsAtom, {
        orgId,
        records: (items ?? []).map(trackerItemToRecord),
      });
    }).catch((error) => {
      if (cancelled) return;
      console.error('[TeamMode] Failed to load tracker metadata:', error);
    });
    return () => { cancelled = true; };
  }, [orgId, trackerStore]);

  // Keyed on the id, not the entry object: every directory refresh produces a
  // fresh descriptor object for the same room, which would otherwise refetch
  // the membership list on each one.
  useEffect(() => {
    if (!activeConversationId) return;
    void refreshConversationMembers({
      orgId,
      conversationId: activeConversationId,
    }).catch(() => undefined);
  }, [activeConversationId, orgId]);

  const dialogs = useOrgModeDialogs({
    orgId,
    conversations,
    roster,
    participantsByConversationId,
    membershipsByConversationId,
    gating,
    onRoute,
  });
  const {
    openCompose,
    openCreateRoom,
    openNewDm,
    openPreferences,
    openRoomSettings,
  } = dialogs;

  const openDirectory = useCallback(() => onRoute(DIRECTORY_ROUTE), [onRoute]);
  const retryDirectory = useCallback(() => {
    void refreshConversationDirectory(orgId).catch(() => {
      // The load state already carries the failure; the sidebar keeps showing
      // the error line rather than reverting to empty.
    });
  }, [orgId]);

  // The sidebar is memoized, so the two slots it renders have to hold their
  // identity across a navigation or the memo never bites.
  const projectsContent = useMemo(() => (
    <OrgProjectsSidebarSection
      orgId={orgId}
      projects={projectLocalState.projects}
      loading={projectLocalState.loading}
      error={projectLocalState.error}
      onReload={projectLocalState.reload}
    />
  ), [
    orgId,
    projectLocalState.error,
    projectLocalState.loading,
    projectLocalState.projects,
    projectLocalState.reload,
  ]);
  // Always the sidebar footer, rail visible or not: identity is per-organization
  // (a different Stytch member id per org) and the sidebar is the per-org pane,
  // so the indicator must not move around with the rail.
  const sidebarBottomContent = useMemo(() => (
    <OrgUserIndicator
      selectedOrgId={orgId}
      selectedTeamMemberId={roster.viewerUserId}
      selectedEmail={boundEmail}
      onOpenWebConsole={openWebConsole}
      onOpenPreferences={openPreferences}
      placement="top-start"
    />
  ), [
    boundEmail,
    openPreferences,
    openWebConsole,
    orgId,
    roster.viewerUserId,
  ]);

  return (
    <section className="org-mode-host team-mode flex h-full flex-col overflow-hidden bg-[var(--nim-bg)] text-[var(--nim-text)]" data-testid="team-mode" data-component="OrgModeHost">
      {/* Renders nothing: the Messages menu and Cmd+K land here. */}
      <OrgWindowCommandBridge
        surfaceId={surfaceId}
        orgId={orgId}
        route={route}
        sidebar={sidebar}
        inboxProvider={inboxProvider}
        onRoute={onRoute}
        onCompose={gating.roomsVisible || gating.dmsVisible ? openCompose : undefined}
      />
      <OrgWindowMarkReadOnOpen
        orgId={orgId}
        conversationId={route.view === 'conversation' ? route.conversationId : undefined}
        inboxProvider={inboxProvider}
      />
      {chrome === 'window' && (
        <OrgWindowTitleBar
          name={team.name}
          onOpenPreferences={openPreferences}
        />
      )}
      <div className="team-mode-body flex min-h-0 flex-1">
        {showOrgRail && (
          <OrgRail
            organizations={organizations}
            selectedOrgId={orgId}
            onSelectOrganization={onSelectOrganization}
          />
        )}
        {!sidebarCollapsed && (
          <OrgSidebar
            surfaceId={surfaceId}
            chrome={chrome}
            orgId={orgId}
            orgName={team.name}
            model={sidebar}
            directoryLoading={directoryLoadState.status === 'loading'}
            directoryError={directoryLoadState.status === 'error'
              ? directoryLoadState.error ?? 'Directory unavailable'
              : undefined}
            onRetryDirectory={retryDirectory}
            onNavigate={onRoute}
            onCreateRoom={gating.canCreateRoom ? openCreateRoom : undefined}
            onCreateDirectMessage={gating.canCreateDirectMessage ? openNewDm : undefined}
            projectsContent={projectsContent}
            bottomContent={sidebarBottomContent}
          />
        )}

        {/* Every surface in this window is a full-bleed messaging one (list plus
            pane, message list plus composer); the administration panels that
            wanted the narrow form column moved to the dialog. */}
        <main className="team-mode-content team-mode-content-full min-w-0 flex-1 overflow-hidden">
          <>
              {/* Kept mounted once visited, hidden rather than unmounted, the
                  way the project window's modes are. Every Inbox <-> room hop
                  used to rebuild the whole surface, re-read the stored
                  preferences over IPC and restart the relative-label timer,
                  and it dropped the search and selection on the way. */}
              {inboxMounted && (
                <div
                  className={`team-mode-inbox-slot h-full ${route.view === 'inbox' ? '' : 'hidden'}`}
                  data-testid="team-mode-inbox-slot"
                >
                  <InboxProviderContext.Provider value={inboxProvider}>
                    <InboxSection
                      surfaceId={surfaceId}
                      workspacePath={workspacePath}
                      // Org mode lives inside a project window: it renders
                      // under this organization's header and its rows open in
                      // this project's context, so it shows this
                      // organization's deliveries and no others. The standalone
                      // window stays the cross-org surface it is meant to be.
                      restrictToOrgId={chrome === 'mode' ? orgId : undefined}
                      onBrowseRooms={gating.roomsVisible ? openDirectory : undefined}
                      onNewMessage={gating.roomsVisible || gating.dmsVisible
                        ? openCompose
                        : undefined}
                      composeUnavailableLabel="Rooms and direct messages are turned off for this organization"
                    />
                  </InboxProviderContext.Provider>
                </div>
              )}
              {route.view === 'directory' && gating.roomsVisible && (
                <RoomsDirectory
                  orgId={orgId}
                  viewerUserId={roster.viewerUserId}
                  onOpenConversation={(conversationId) => onRoute(conversationRoute(conversationId))}
                  onCreateRoom={gating.canCreateRoom ? openCreateRoom : undefined}
                />
              )}
              {route.view === 'conversation' && (
                activeConversation
                  ? (
                    <RoomView
                      // Deliberately not keyed by conversation: the thread
                      // inside is, which is what actually has to be reset. A
                      // key here tore the header, its menus and every memo in
                      // the view down as well on each room click.
                      orgId={orgId}
                      entry={activeConversation}
                      viewerUserId={roster.viewerUserId}
                      members={roster.members}
                      // Invited-member onboarding lives where the member is
                      // being sent, under the room header, rather than in a
                      // window-wide band above every surface.
                      notice={isGeneralRoomId(activeConversation.id)
                        ? <OrgWelcomeBanner orgId={orgId} />
                        : undefined}
                      dmParticipants={
                        participantsByConversationId[activeConversation.id]
                      }
                      memberCount={
                        activeConversation.visibility === 'public'
                          ? roster.members.length
                          : activeMemberships?.filter(
                            (membership) => membership.removedAt === undefined,
                          ).length
                      }
                      onOpenRoomSettings={activeConversation.kind === 'orgRoom'
                        ? () => openRoomSettings(activeConversation.id, 'details')
                        : undefined}
                      onInviteMembers={activeConversation.kind === 'orgRoom'
                        ? () => openRoomSettings(activeConversation.id, 'members')
                        : undefined}
                      projectWorkspacePath={activeConversationProjectWorkspace}
                      onOpenProject={openProjectWorkspace}
                    />
                  )
                  : (
                    <div
                      className="org-conversation-missing flex h-full items-center justify-center text-sm text-[var(--nim-text-muted)]"
                      data-testid="org-conversation-missing"
                    >
                      {routedConversation.resolving
                        ? 'Loading conversation…'
                        : 'That conversation is no longer available.'}
                    </div>
                  )
              )}
          </>
        </main>
      </div>

      {/* Outside the body flex row and shrink-0, so the disclosure reserves its
          own height rather than overlaying either the sidebar or the room. */}
      {chrome === 'window' && <OrgWindowStatusBar />}

      {dialogs.element}
    </section>
  );
}
