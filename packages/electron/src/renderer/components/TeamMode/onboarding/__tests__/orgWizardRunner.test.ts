// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { createOrgWizardState, type OrgWizardState } from '../orgWizardModel';
import {
  runCreateOrganization,
  runSendInvites,
  type OrgWizardApi,
} from '../orgWizardRunner';

function fakeApi(overrides: Partial<OrgWizardApi> = {}): OrgWizardApi {
  return {
    findPendingInvitation: vi.fn(async () => null),
    acceptInvitation: vi.fn(async (orgId: string) => ({ orgId })),
    createOrganization: vi.fn(async () => ({ orgId: 'org-1' })),
    inviteMember: vi.fn(async () => {}),
    publishFolder: vi.fn(async () => true),
    ...overrides,
  };
}

function created(overrides: Partial<OrgWizardState> = {}): OrgWizardState {
  return {
    ...createOrgWizardState({ orgName: 'Acme' }),
    createdOrgId: 'org-1',
    step: 'invite',
    ...overrides,
  };
}

describe('runCreateOrganization', () => {
  it('creates the organization and records its id', async () => {
    const api = fakeApi();
    const state = await runCreateOrganization(createOrgWizardState({ orgName: 'Acme' }), api);
    expect(state.createdOrgId).toBe('org-1');
    expect(api.createOrganization).toHaveBeenCalledWith({
      name: 'Acme',
      sourcePersonalOrgId: undefined,
    });
  });

  it('never creates a second organization when the step re-runs', async () => {
    const api = fakeApi();
    const once = await runCreateOrganization(createOrgWizardState({ orgName: 'Acme' }), api);
    const twice = await runCreateOrganization(once, api);
    expect(twice.createdOrgId).toBe('org-1');
    expect(api.createOrganization).toHaveBeenCalledTimes(1);
  });

  it('surfaces a failure without advancing', async () => {
    const api = fakeApi({
      createOrganization: vi.fn(async () => { throw new Error('alpha is invite-only'); }),
    });
    const state = await runCreateOrganization(createOrgWizardState({ orgName: 'Acme' }), api);
    expect(state.createdOrgId).toBeNull();
    expect(state.error).toContain('invite-only');
  });

  it('refuses an empty name', async () => {
    const api = fakeApi();
    const state = await runCreateOrganization(createOrgWizardState({ orgName: '  ' }), api);
    expect(api.createOrganization).not.toHaveBeenCalled();
    expect(state.error).toBeTruthy();
  });
});

describe('runSendInvites', () => {
  it('invites each staged address once', async () => {
    const api = fakeApi();
    const state = await runSendInvites(
      created({ emails: ['karl@example.com', 'josh@example.com'] }),
      api,
    );
    expect(api.inviteMember).toHaveBeenCalledTimes(2);
    expect(state.invitedEmails).toEqual(['karl@example.com', 'josh@example.com']);
    expect(state.error).toBeNull();
  });

  it('re-sends nothing when the step runs again', async () => {
    const api = fakeApi();
    const once = await runSendInvites(created({ emails: ['karl@example.com'] }), api);
    await runSendInvites(once, api);
    expect(api.inviteMember).toHaveBeenCalledTimes(1);
  });

  /**
   * A publish is a one-time copy, so re-running the step after a partial
   * failure must not copy a folder that already landed — that would leave the
   * team with two sets of the same documents and no way to tell them apart.
   */
  it('publishes each selected folder once, after the invitations', async () => {
    const api = fakeApi();
    const once = await runSendInvites(
      created({ emails: ['karl@example.com'], publishFolders: ['/w/docs', '/w/specs'] }),
      api,
    );
    expect(api.publishFolder).toHaveBeenCalledTimes(2);
    expect(once.publishedFolders).toEqual(['/w/docs', '/w/specs']);
    expect(once.error).toBeNull();

    await runSendInvites(once, api);
    expect(api.publishFolder).toHaveBeenCalledTimes(2);
  });

  /** Copying into a team nobody was invited to is work the user has to undo. */
  it('publishes nothing when every invitation failed', async () => {
    const api = fakeApi({
      inviteMember: vi.fn(async () => { throw new Error('nope'); }),
    });
    const state = await runSendInvites(
      created({ emails: ['karl@example.com'], publishFolders: ['/w/docs'] }),
      api,
    );
    expect(api.publishFolder).not.toHaveBeenCalled();
    expect(state.publishedFolders).toEqual([]);
  });

  /**
   * "Some invitations failed" would send the creator to re-invite people who
   * already have their email. The two failures are different problems and have
   * to read as different problems.
   */
  it('does not report a failed publish as a failed invitation', async () => {
    const api = fakeApi({ publishFolder: vi.fn(async () => false) });
    const state = await runSendInvites(
      created({ emails: ['karl@example.com'], publishFolders: ['/w/docs'] }),
      api,
    );
    expect(state.invitedEmails).toEqual(['karl@example.com']);
    expect(state.error).toBe('Some folders were not published — /w/docs');
  });

  it('keeps the addresses that succeeded when one fails', async () => {
    const api = fakeApi({
      inviteMember: vi.fn(async (_orgId: string, email: string) => {
        if (email === 'josh@example.com') throw new Error('already a member');
      }),
    });
    const state = await runSendInvites(
      created({ emails: ['karl@example.com', 'josh@example.com'] }),
      api,
    );
    expect(state.invitedEmails).toEqual(['karl@example.com']);
    expect(state.error).toContain('josh@example.com');

    // The retry only covers the address that never went out.
    await runSendInvites({ ...state, error: null }, api);
    expect(api.inviteMember).toHaveBeenCalledTimes(3);
  });

  it('refuses to run before the organization exists', async () => {
    const api = fakeApi();
    const state = await runSendInvites(
      { ...createOrgWizardState(), emails: ['karl@example.com'] },
      api,
    );
    expect(api.inviteMember).not.toHaveBeenCalled();
    expect(state.error).toBeTruthy();
  });
});
