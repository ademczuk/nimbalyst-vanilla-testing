/**
 * The live wiring behind `OrgWizardApi` — every call the wizard makes goes
 * through an existing path (the team create/invite IPC). Nothing new was added
 * server-side.
 */

import type { OrgWizardApi } from './orgWizardRunner';

export function createOrgWizardApi(): OrgWizardApi {
  return {
    async findPendingInvitation(email) {
      const result = await window.electronAPI.organization.findPendingInvitation(email);
      if (result?.success === false) {
        throw new Error(result.error ?? 'Could not check pending invitations');
      }
      const invitation = result?.invitation;
      if (!invitation?.orgId) return null;
      return {
        orgId: invitation.orgId as string,
        name: typeof invitation.name === 'string' ? invitation.name : 'Organization',
        email,
      };
    },

    async acceptInvitation(orgId) {
      const result = await window.electronAPI.organization.acceptInvitation(orgId);
      if (!result?.success || !result.team?.orgId) {
        throw new Error(result?.error ?? 'Could not accept the invitation');
      }
      return { orgId: result.team.orgId as string };
    },

    async createOrganization({ name, sourcePersonalOrgId, workspacePath }) {
      const result = await window.electronAPI.organization.create({
        name,
        sourcePersonalOrgId,
        workspacePath,
      });
      if (!result?.success || !result.team?.orgId) {
        throw new Error(result?.error ?? 'Could not create the organization');
      }
      return { orgId: result.team.orgId as string };
    },

    async inviteMember(orgId, email) {
      const result = await window.electronAPI.organization.inviteMember(orgId, email);
      if (result?.success === false) {
        throw new Error(result.error ?? 'Could not send the invitation');
      }
    },

    // A brand-new org has exactly one project, and every member is granted it
    // automatically, so the wizard has no project choice to offer — publishing
    // content is the only thing standing between an invitee and an empty
    // workspace here.
    async publishFolder(folderPath) {
      const { publishFoldersForInvite } = await import(
        '../../InviteToTeamDialog/publishFoldersForInvite'
      );
      const outcome = await publishFoldersForInvite([folderPath]);
      return outcome.published > 0;
    },
  };
}
