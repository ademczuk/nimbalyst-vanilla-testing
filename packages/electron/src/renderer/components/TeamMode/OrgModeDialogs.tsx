import React, { useCallback, useState } from 'react';

import type { ConversationMembership } from '@nimbalyst/collab-protocol';

import type { ConversationDirectoryEntry } from '../../../shared/conversationDirectory';
import {
  refreshConversationDirectory,
  setConversationMemberships,
} from '../../store/listeners/conversationDirectoryListeners';
import { ComposeDestinationDialog } from './ComposeDestinationDialog';
import { CreateRoomDialog } from './CreateRoomDialog';
import { NewDirectMessageDialog } from './NewDirectMessageDialog';
import { OrgPreferencesDialog } from './OrgPreferencesDialog';
import { RoomSettingsDialog, type RoomSettingsSection } from './RoomSettingsDialog';
import type { OrgMessagingGating } from './orgSidebarViewModel';
import { conversationRoute, type OrgWindowRoute } from './orgWindowState';
import type { OrgRoster } from './useOrgRoster';

type OrgWindowDialog =
  | { kind: 'createRoom' }
  | { kind: 'newDm' }
  | { kind: 'compose' }
  | { kind: 'preferences' }
  | {
    kind: 'roomSettings';
    conversationId: string;
    section: RoomSettingsSection;
  }
  | null;

export interface OrgModeDialogs {
  openCompose: () => void;
  openPreferences: () => void;
  openCreateRoom: () => void;
  openNewDm: () => void;
  openRoomSettings: (
    conversationId: string,
    section: RoomSettingsSection,
  ) => void;
  /** The open dialog, rendered by the body at the end of its own tree. */
  element: React.ReactNode;
}

/**
 * The window's room-management dialogs, held here rather than in the global
 * dialog registry: each one reads org-scoped live state (roster, directory) and
 * hands a conversation id back to the window to route to, which the registry's
 * open-with-fixed-data shape does not carry.
 *
 * The open callbacks are stable, because the sidebar and the command bridge are
 * memoized on them.
 */
export function useOrgModeDialogs({
  orgId,
  conversations,
  roster,
  participantsByConversationId,
  membershipsByConversationId,
  gating,
  onRoute,
}: {
  orgId: string;
  conversations: readonly ConversationDirectoryEntry[];
  roster: OrgRoster;
  participantsByConversationId: Readonly<Record<string, readonly string[]>>;
  membershipsByConversationId: Readonly<Record<string, readonly ConversationMembership[]>>;
  gating: OrgMessagingGating;
  onRoute: (route: OrgWindowRoute) => void;
}): OrgModeDialogs {
  const [dialog, setDialog] = useState<OrgWindowDialog>(null);
  const settingsConversation = dialog?.kind === 'roomSettings'
    ? conversations.find((entry) => entry.id === dialog.conversationId) ?? null
    : null;

  // Route only once the directory holds the new conversation: routing first
  // would render "that conversation is no longer available" against a listing
  // that has not caught up with the create yet.
  const openConversation = useCallback(async (conversationId: string) => {
    await refreshConversationDirectory(orgId).catch(() => undefined);
    setDialog(null);
    onRoute(conversationRoute(conversationId));
  }, [onRoute, orgId]);

  const openCompose = useCallback(() => setDialog({ kind: 'compose' }), []);
  const openPreferences = useCallback(() => setDialog({ kind: 'preferences' }), []);
  const openCreateRoom = useCallback(() => setDialog({ kind: 'createRoom' }), []);
  const openNewDm = useCallback(() => setDialog({ kind: 'newDm' }), []);
  const openRoomSettings = useCallback((
    conversationId: string,
    section: RoomSettingsSection,
  ) => setDialog({ kind: 'roomSettings', conversationId, section }), []);

  // The gating guards below matter because settings can change while a
  // dialog is open: another admin turning rooms off must close the
  // create-room sheet, not leave it submitting into a rejection.
  const element = (
    <>
      {dialog?.kind === 'createRoom' && gating.canCreateRoom && (
        <CreateRoomDialog
          orgId={orgId}
          members={roster.members}
          viewerUserId={roster.viewerUserId}
          existingConversations={conversations}
          onClose={() => setDialog(null)}
          onCreated={(conversationId) => { void openConversation(conversationId); }}
        />
      )}
      {dialog?.kind === 'newDm' && gating.canCreateDirectMessage && (
        <NewDirectMessageDialog
          orgId={orgId}
          members={roster.members}
          viewerUserId={roster.viewerUserId}
          conversations={conversations}
          participantsByConversationId={participantsByConversationId}
          onClose={() => setDialog(null)}
          onOpened={(conversationId) => { void openConversation(conversationId); }}
        />
      )}
      {dialog?.kind === 'compose'
        && (gating.roomsVisible || gating.dmsVisible) && (
        <ComposeDestinationDialog
          orgId={orgId}
          conversations={conversations}
          members={roster.members}
          viewerUserId={roster.viewerUserId}
          participantsByConversationId={participantsByConversationId}
          allowRooms={gating.roomsVisible}
          allowDirectMessages={gating.dmsVisible}
          onClose={() => setDialog(null)}
          onOpenConversation={(conversationId) => { void openConversation(conversationId); }}
        />
      )}
      {dialog?.kind === 'preferences' && (
        <OrgPreferencesDialog onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'roomSettings' && settingsConversation && (
        <RoomSettingsDialog
          orgId={orgId}
          entry={settingsConversation}
          members={roster.members}
          viewerUserId={roster.viewerUserId}
          memberships={
            membershipsByConversationId[settingsConversation.id] ?? null
          }
          onMembershipsChange={(memberships) => {
            setConversationMemberships(
              {
                orgId,
                conversationId: settingsConversation.id,
              },
              memberships,
            );
          }}
          initialSection={dialog.section}
          onClose={() => setDialog(null)}
          onArchived={() => {
            // The archived room drops out of the sidebar, so the window cannot
            // stay pointed at it.
            setDialog(null);
            onRoute({ view: 'inbox' });
            void refreshConversationDirectory(orgId).catch(() => undefined);
          }}
        />
      )}
    </>
  );

  return {
    openCompose,
    openPreferences,
    openCreateRoom,
    openNewDm,
    openRoomSettings,
    element,
  };
}
