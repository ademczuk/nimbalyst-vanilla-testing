/**
 * The two things a user with no organization to look at can still do: accept an
 * invitation they were sent, and create an organization.
 *
 * Extracted from `OrganizationMembersRolesPanel` so the organization window's
 * unbound surface can offer them without also rendering that panel's roster
 * chrome ("Members & Roles", "Choose an organization"), which is administration
 * — the ORG_MANAGEMENT dialog's job since NIM-2322, not that window's.
 */

import React from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';

import { TeamBetaNotice } from '../../common/TeamBetaNotice';
import { categorizeTeamAnalyticsError } from '../../../../shared/analytics/teamAnalytics';
import { trackTeamAnalyticsEvent } from '../../../utils/teamAnalytics';
import { organizationCreationEnabled } from '../../../store/atoms/settingsDomains';
// Narrow imports: the `dialogs` barrel would drag every dialog component into
// this panel's module graph.
import { DIALOG_IDS } from '../../../dialogs/registry';
import { dialogRef } from '../../../contexts/DialogContext';
import { queueOrgWindowGeneralRoute } from '../../TeamMode/onboarding/orgOnboardingStorage';

export interface OrganizationChoice {
  orgId: string;
  name: string;
  membershipType?: string;
  sourceEmail?: string | null;
}

export function OrganizationOnboardingChoices({
  organizations,
  onChanged,
  onError,
  // Invite-only beta: the create-org card only renders in dev builds.
  allowOrganizationCreation = organizationCreationEnabled,
  showBetaNotice = true,
}: {
  organizations: OrganizationChoice[];
  /** Re-read the directory: a membership was accepted. */
  onChanged: () => void;
  onError: (message: string) => void;
  allowOrganizationCreation?: boolean;
  /** Off where the host already discloses the beta on the same screen. */
  showBetaNotice?: boolean;
}) {
  const pending = organizations.filter(
    (organization) => organization.membershipType && organization.membershipType !== 'active_member',
  );

  const acceptInvitation = (invitation: OrganizationChoice) => {
    void window.electronAPI.organization.acceptInvitation(invitation.orgId)
      .then(async (result: { success?: boolean; error?: string }) => {
        if (result?.success === false) throw new Error(result.error ?? 'Could not accept invitation');
        trackTeamAnalyticsEvent('team_invitation_accepted', {
          surface: 'desktop',
          entryPoint: 'organization_manager',
          projectMatched: false,
        });
        // Land the new member in the organization on #general rather than
        // leaving them looking at a settings list.
        if (!(await queueOrgWindowGeneralRoute(invitation.orgId))) {
          throw new Error(
            'Invitation accepted, but the organization destination could not be saved. Try again.',
          );
        }
        // Deliberately still the window: #general is a conversation, and
        // conversations are what `openManagementWindow` opens since NIM-2322
        // moved administration into the ORG_MANAGEMENT dialog.
        void window.electronAPI?.team?.openManagementWindow?.({ orgId: invitation.orgId });
        onChanged();
      })
      .catch((reason: unknown) => {
        trackTeamAnalyticsEvent('team_operation_failed', {
          surface: 'desktop',
          operation: 'accept_invitation',
          entryPoint: 'organization_manager',
          errorCategory: categorizeTeamAnalyticsError('organization', reason),
        });
        onError(String(reason));
      });
  };

  return (
    <div
      className="organization-onboarding-choices"
      data-testid="organization-onboarding-choices"
      data-component="OrganizationOnboardingChoices"
    >
      {pending.length > 0 && (
        <div className="organization-invitation-inbox mb-5" data-testid="organization-invitation-inbox">
          <h3 className="m-0 mb-2 text-sm font-semibold">Pending invitations</h3>
          <div className="flex flex-col gap-2">
            {pending.map((invitation) => (
              <article
                key={`${invitation.orgId}:${invitation.sourceEmail ?? ''}`}
                className="pending-invitation-card flex items-center gap-3 rounded-lg border border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] p-3"
                data-testid="pending-invitation-card"
              >
                <MaterialSymbol icon="mail" size={18} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{invitation.name}</div>
                  <div className="text-xs text-[var(--nim-text-muted)]">
                    Invited account: {invitation.sourceEmail ?? 'signed-in account'}
                  </div>
                </div>
                <button
                  type="button"
                  className="pending-invitation-accept org-window-no-drag rounded-md bg-[var(--nim-primary)] px-3 py-1.5 text-xs font-semibold text-[var(--nim-on-primary)]"
                  data-testid="pending-invitation-accept"
                  onClick={() => acceptInvitation(invitation)}
                >
                  Accept
                </button>
              </article>
            ))}
          </div>
        </div>
      )}

      {allowOrganizationCreation && (
        <div
          className="new-organization-card mb-5 rounded-lg border border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] p-3"
          data-testid="new-organization-card"
        >
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">New organization</div>
              <div className="mt-0.5 text-xs text-[var(--nim-text-muted)]">
                Name it, invite your team, and pick starting rooms.
              </div>
            </div>
            <button
              type="button"
              className="new-organization-launch org-window-no-drag rounded bg-[var(--nim-primary)] px-3 py-2 text-sm font-semibold text-[var(--nim-on-primary)]"
              data-testid="new-organization-launch"
              onClick={() => dialogRef.current?.open(DIALOG_IDS.ORG_CREATION_WIZARD, {
                onOrganizationCreated: () => onChanged(),
              })}
            >
              Create organization
            </button>
          </div>
          {showBetaNotice && <TeamBetaNotice className="mt-3" />}
        </div>
      )}
    </div>
  );
}
