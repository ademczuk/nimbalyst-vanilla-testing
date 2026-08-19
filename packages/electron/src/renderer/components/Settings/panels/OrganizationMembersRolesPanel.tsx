import React, { useCallback, useEffect, useState } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import { useAtomValue } from 'jotai';
import { ActionGuard } from './ActionGuard';
import { OrganizationOnboardingChoices } from './OrganizationOnboardingChoices';
import { AlphaBadge } from '../../common/AlphaBadge';
import { TEAM_BETA_TOOLTIP } from '../../common/TeamBetaNotice';
import {
  bucketMemberCount,
  categorizeTeamAnalyticsError,
  normalizeTeamAnalyticsCallerRole,
} from '../../../../shared/analytics/teamAnalytics';
import { trackTeamAnalyticsEvent } from '../../../utils/teamAnalytics';
import { organizationCreationEnabled } from '../../../store/atoms/settingsDomains';
import { teamPresenceAtomFamily } from '../../../store/atoms/teamPresence';
import { requestConfirmation } from '../../../dialogs/requestConfirmation';

interface Member {
  memberId: string;
  email: string;
  name: string;
  status: string;
  role: string;
}

interface OrganizationSummary {
  orgId: string;
  name: string;
  role: string;
  membershipType?: string;
  sourceEmail?: string | null;
}

export function OrganizationMembersRolesPanel({
  orgId,
  readOnlyRoles = false,
  // Invite-only beta: the create-org card only renders in dev builds.
  allowOrganizationCreation = organizationCreationEnabled,
}: {
  orgId?: string;
  readOnlyRoles?: boolean;
  allowOrganizationCreation?: boolean;
}) {
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [callerRole, setCallerRole] = useState('member');
  const [inviteEmail, setInviteEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    const directory = await window.electronAPI.organization.list();
    const teams = directory?.success && Array.isArray(directory.teams) ? directory.teams : [];
    setOrganizations(teams);
    if (!orgId) return;
    const roster = await window.electronAPI.organization.listMembers(orgId);
    if (roster?.success) {
      setMembers(roster.members ?? []);
      setCallerRole(roster.callerRole ?? teams.find((team: OrganizationSummary) => team.orgId === orgId)?.role ?? 'member');
    }
  }, [orgId]);

  useEffect(() => { void refresh().catch((reason) => setError(String(reason))); }, [refresh]);
  const canAdminister = callerRole === 'owner' || callerRole === 'admin';
  const analyticsCallerRole = normalizeTeamAnalyticsCallerRole(callerRole);

  const removeMember = useCallback(async (member: Member) => {
    if (!orgId) return;
    const label = member.name || member.email || 'this member';
    const isPending = member.status === 'pending';
    const confirmed = await requestConfirmation({
      title: isPending ? 'Revoke invitation' : 'Remove member',
      message: isPending
        ? `Revoke the pending invitation for ${label}?`
        : `Remove ${label} from this organization? They lose access to its shared documents and trackers, and would have to be invited again.`,
      confirmLabel: isPending ? 'Revoke' : 'Remove',
      destructive: true,
    });
    if (!confirmed) return;

    setError(null);
    try {
      const result = await window.electronAPI.organization.removeMember(orgId, member.memberId);
      if (result?.success === false) throw new Error(result.error ?? 'Could not remove member');
      trackTeamAnalyticsEvent('team_member_removed', {
        surface: 'desktop',
        callerRole: analyticsCallerRole,
        memberState: isPending ? 'pending' : 'active',
      });
      await refresh();
    } catch (reason) {
      trackTeamAnalyticsEvent('team_operation_failed', {
        surface: 'desktop',
        operation: 'remove_member',
        entryPoint: 'organization_manager',
        callerRole: analyticsCallerRole,
        errorCategory: categorizeTeamAnalyticsError('organization', reason),
      });
      setError(String(reason));
    }
  }, [orgId, analyticsCallerRole, refresh]);

  const selected = organizations.find((organization) => organization.orgId === orgId);

  return (
    <section className="organization-members-roles-panel" data-testid="organization-members-roles-panel" data-component="OrganizationMembersRolesPanel">
      <header className="mb-5 border-b border-[var(--nim-border)] pb-4">
        <h2 className="m-0 flex items-center gap-2 text-xl font-semibold">
          Members &amp; Roles
          <AlphaBadge size="sm" stage="beta" tooltip={TEAM_BETA_TOOLTIP} />
        </h2>
        <p className="m-0 mt-1 text-sm text-[var(--nim-text-muted)]">
          {selected ? `${selected.name} · ${callerRole}${selected.sourceEmail ? ` · ${selected.sourceEmail}` : ''}` : 'Choose an organization.'}
        </p>
      </header>

      <OrganizationOnboardingChoices
        organizations={organizations}
        onChanged={() => { void refresh(); }}
        onError={setError}
        allowOrganizationCreation={allowOrganizationCreation}
      />

      {orgId && (
        <>
          <div className="organization-roster flex flex-col gap-2" data-testid="organization-roster">
            {members.map((member) => (
              <div key={member.memberId} className="member-row flex items-center gap-3 rounded-lg border border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] p-3" data-testid="organization-member-row">
                <MemberPresenceDot orgId={orgId} memberId={member.memberId} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{member.name || member.email}</div>
                  <div className="truncate text-xs text-[var(--nim-text-muted)]">{member.email}</div>
                </div>
                {readOnlyRoles ? (
                  <span className="member-role-badge rounded-full bg-[var(--nim-bg-tertiary)] px-2.5 py-1 text-xs capitalize text-[var(--nim-text-muted)]">
                    {member.role}
                  </span>
                ) : <select
                  value={member.role}
                  disabled={!canAdminister}
                  className="member-role-select rounded border border-[var(--nim-border)] bg-[var(--nim-bg-tertiary)] px-2 py-1 text-xs disabled:cursor-not-allowed"
                  data-testid="member-role-select"
                  onChange={(event) => {
                    const nextRole = event.target.value;
                    void window.electronAPI.organization.updateMemberRole(orgId, member.memberId, nextRole)
                      .then((result) => {
                        if (result?.success === false) throw new Error(result.error ?? 'Could not update member role');
                        trackTeamAnalyticsEvent('team_member_role_changed', {
                          surface: 'desktop',
                          callerRole: analyticsCallerRole,
                          fromRole: normalizeTeamAnalyticsCallerRole(member.role),
                          toRole: normalizeTeamAnalyticsCallerRole(nextRole),
                        });
                        return refresh();
                      })
                      .catch((reason) => {
                        trackTeamAnalyticsEvent('team_operation_failed', {
                          surface: 'desktop',
                          operation: 'change_member_role',
                          entryPoint: 'organization_manager',
                          callerRole: analyticsCallerRole,
                          errorCategory: categorizeTeamAnalyticsError('organization', reason),
                        });
                        setError(String(reason));
                      });
                  }}
                >
                  <option value="viewer">Viewer</option>
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                  <option value="owner">Owner</option>
                </select>}
                {canAdminister && (
                  <button
                    type="button"
                    className="member-remove-button rounded border border-[var(--nim-border)] bg-transparent p-1.5 text-[var(--nim-text-muted)] hover:border-[var(--nim-error)] hover:text-[var(--nim-error)]"
                    data-testid="organization-member-remove"
                    title={member.status === 'pending' ? 'Revoke invitation' : 'Remove from organization'}
                    aria-label={member.status === 'pending'
                      ? `Revoke invitation for ${member.name || member.email}`
                      : `Remove ${member.name || member.email} from this organization`}
                    onClick={() => { void removeMember(member); }}
                  >
                    <MaterialSymbol icon="person_remove" size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>

          <ActionGuard allowed={canAdminister} reason="An organization owner or admin is required to invite members.">
            <form
              className="organization-invite-form mt-4 flex gap-2"
              data-testid="organization-invite-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!inviteEmail.trim()) return;
                void window.electronAPI.organization.inviteMember(orgId, inviteEmail.trim())
                  .then((result) => {
                    if (result?.success === false) throw new Error(result.error ?? 'Could not send invitation');
                    trackTeamAnalyticsEvent('team_invitation_sent', {
                      surface: 'desktop',
                      entryPoint: 'organization_manager',
                      callerRole: analyticsCallerRole,
                      memberCountBucket: bucketMemberCount(members.length + 1),
                    });
                    setInviteEmail('');
                    return refresh();
                  })
                  .catch((reason) => {
                    trackTeamAnalyticsEvent('team_operation_failed', {
                      surface: 'desktop',
                      operation: 'send_invitation',
                      entryPoint: 'organization_manager',
                      callerRole: analyticsCallerRole,
                      errorCategory: categorizeTeamAnalyticsError('organization', reason),
                    });
                    setError(String(reason));
                  });
              }}
            >
              <input className="min-w-0 flex-1 rounded border border-[var(--nim-border)] bg-[var(--nim-bg)] px-3 py-2 text-sm" type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="teammate@example.com" />
              <button className="rounded bg-[var(--nim-primary)] px-3 py-2 text-sm font-semibold text-[var(--nim-on-primary)]" type="submit">Invite</button>
            </form>
          </ActionGuard>
        </>
      )}
      {error && <p className="select-text text-sm text-[var(--nim-error)]">{error}</p>}
    </section>
  );
}

function MemberPresenceDot({
  orgId,
  memberId,
}: {
  orgId: string;
  memberId: string;
}) {
  const presence = useAtomValue(teamPresenceAtomFamily({
    orgId,
    teamMemberId: memberId,
  }));
  const status = presence?.status ?? 'offline';
  const color = status === 'online'
    ? 'bg-[var(--nim-success)]'
    : status === 'away'
      ? 'bg-[var(--nim-warning)]'
      : 'bg-[var(--nim-text-disabled)]';
  return (
    <span
      className={`member-presence-dot size-2.5 shrink-0 rounded-full ${color}`}
      aria-label={status}
    />
  );
}
