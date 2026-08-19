import { asTeamJwt } from '@nimbalyst/runtime';
import type {
  TeamInboxOrgClientLike,
  TeamInboxOrgDescriptor,
  TeamInboxOrgEvent,
} from '@nimbalyst/runtime/sync';
import { describe, expect, it, vi } from 'vitest';

import { TeamInboxService } from '../TeamInboxService';

class FakeOrgClient implements TeamInboxOrgClientLike {
  readonly connect = vi.fn(async () => {});
  readonly markRead = vi.fn(async () => {});
  readonly dismiss = vi.fn(async () => {});
  readonly claimAgentDelivery = vi.fn(async () => true);
  readonly completeAgentDelivery = vi.fn(async () => true);
  readonly destroy = vi.fn();
  private listener: ((event: TeamInboxOrgEvent) => void) | null = null;

  constructor(readonly org: TeamInboxOrgDescriptor) {}

  subscribe(listener: (event: TeamInboxOrgEvent) => void): () => void {
    this.listener = listener;
    return () => { this.listener = null; };
  }
}

describe('TeamInboxService JWT selection', () => {
  it('resolves the inbox member id and connection exclusively from the org-scoped team JWT', async () => {
    const getTeamJwt = vi.fn(async () => asTeamJwt('team-jwt'));
    const clients: FakeOrgClient[] = [];
    const service = new TeamInboxService({
      listOrganizations: vi.fn(async () => [{
        orgId: 'org-a',
        name: 'Acme',
        gitRemoteHash: null,
        createdAt: '2026-07-26T00:00:00.000Z',
        role: 'member',
        membershipType: 'active_member',
        boundPersonalOrgId: 'personal-account-a',
      }]),
      getTeamJwt,
      getServerUrl: () => 'https://sync.example.test',
      getTeamMemberId: (jwt) =>
        jwt === 'team-jwt' ? 'team-member-a' : null,
      createOrgClient: (org) => {
        const client = new FakeOrgClient(org);
        clients.push(client);
        return client;
      },
    });

    await service.start();

    expect(getTeamJwt).toHaveBeenCalledWith(
      'org-a',
      'personal-account-a',
    );
    expect(clients[0].org).toMatchObject({
      orgId: 'org-a',
      teamMemberId: 'team-member-a',
    });
    service.destroy();
  });
});

describe('TeamInboxService auth readiness', () => {
  /**
   * Session restore starts the inbox before Stytch finishes initializing, so
   * `listTeams` answers `[]` and the fan-in comes up with no rooms. Because
   * `start()` short-circuits on the fan-in it already built, that empty result
   * used to stick for the whole run — every notification, mention wake and
   * feedback-request quorum wake silently dropped, while the snapshot reported
   * `ready` the entire time.
   */
  it('waits for authentication instead of latching an empty organization list', async () => {
    let authenticated = false;
    const listeners = new Set<(state: { isAuthenticated: boolean }) => void>();
    const listOrganizations = vi.fn(async () => (authenticated
      ? [{
          orgId: 'org-a',
          name: 'Acme',
          gitRemoteHash: null,
          createdAt: '2026-07-26T00:00:00.000Z',
          role: 'member',
          membershipType: 'active_member',
          boundPersonalOrgId: 'personal-account-a',
        }]
      : []));
    const clients: FakeOrgClient[] = [];
    const service = new TeamInboxService({
      listOrganizations,
      getTeamJwt: async () => asTeamJwt('team-jwt'),
      getServerUrl: () => 'https://sync.example.test',
      getTeamMemberId: () => 'team-member-a',
      createOrgClient: (org) => {
        const client = new FakeOrgClient(org);
        clients.push(client);
        return client;
      },
      isAuthenticated: () => authenticated,
      onAuthStateChange: (listener) => {
        listeners.add(listener);
        listener({ isAuthenticated: authenticated });
        return () => listeners.delete(listener);
      },
    });

    // Too early: the organization list is never even asked for, so an empty
    // answer cannot be mistaken for "this user belongs to no teams".
    await service.start();
    expect(listOrganizations).not.toHaveBeenCalled();
    expect(service.getSnapshot().organizations).toEqual([]);

    authenticated = true;
    for (const listener of [...listeners]) listener({ isAuthenticated: true });
    // The retry runs through start(); let its promise chain settle.
    await vi.waitFor(() => expect(clients).toHaveLength(1));

    expect(clients[0].org).toMatchObject({ orgId: 'org-a' });
    service.destroy();
    expect(listeners.size).toBe(0);
  });
});
