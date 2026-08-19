import {
  DEFAULT_TEAM_INBOX_CONNECT_CONCURRENCY,
  TeamInboxFanIn,
  TeamInboxOrgClient,
  type PresenceDesiredStatus,
  type TeamInboxOrgClientLike,
  type TeamInboxOrgDescriptor,
  type TeamInboxSnapshot,
} from '@nimbalyst/runtime/sync';
import { asTeamMemberId, type TeamJwt } from '@nimbalyst/runtime';

import { getCollabSyncHttpUrl } from '../utils/collabSyncUrl';
import { getSettingsService } from './SettingsService';
import { getSubFromJwt } from './jwtOrg';
import { isAuthenticated, onAuthStateChange } from './StytchAuthService';
import {
  getOrgScopedJwt,
  listTeams,
  type TeamDetails,
} from './TeamService';

export interface TeamInboxServiceDependencies {
  listOrganizations: () => Promise<TeamDetails[]>;
  getTeamJwt: (
    orgId: string,
    accountOrgId?: string,
  ) => Promise<TeamJwt>;
  getServerUrl: () => string;
  getTeamMemberId: (jwt: TeamJwt) => string | null;
  createOrgClient?: (
    org: TeamInboxOrgDescriptor,
    getTeamJwtForOrg: () => Promise<TeamJwt>,
  ) => TeamInboxOrgClientLike;
  connectConcurrency?: number;
  /**
   * Auth readiness. Session restore runs before Stytch finishes initializing,
   * so the inbox can be asked to start while `listOrganizations` still answers
   * with an empty list — see `deferUntilAuthenticated`.
   */
  isAuthenticated?: () => boolean;
  onAuthStateChange?: (
    listener: (state: { isAuthenticated: boolean }) => void,
  ) => () => void;
}

type ResolvedInboxOrganization =
  | {
      descriptor: TeamInboxOrgDescriptor;
      getTeamJwtForOrg: () => Promise<TeamJwt>;
      resolutionError?: never;
    }
  | {
      descriptor: TeamInboxOrgDescriptor;
      resolutionError: string;
      getTeamJwtForOrg?: never;
    };

const DEFAULT_SNAPSHOT: TeamInboxSnapshot = {
  status: 'loading',
  deliveries: [],
  organizations: [],
  presence: {},
};

function activeOrganization(team: TeamDetails): boolean {
  return !team.membershipType || team.membershipType === 'active_member';
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(values[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

/**
 * Main-process owner for the merged Teams inbox.
 *
 * JWT acquisition and WebSocket connections stay out of the renderer. The
 * service resolves one branded team JWT per organization, derives that
 * organization's member id from the same token, and then lets the runtime
 * fan-in merge independently isolated room streams.
 */
export class TeamInboxService {
  private readonly dependencies: TeamInboxServiceDependencies;
  private readonly listeners = new Set<(snapshot: TeamInboxSnapshot) => void>();
  private readonly deliveryListeners = new Set<
    (delivery: TeamInboxSnapshot['deliveries'][number]) => void
  >();
  private fanIn: TeamInboxFanIn | null = null;
  private fanInCleanup: (() => void) | null = null;
  private snapshot: TeamInboxSnapshot = DEFAULT_SNAPSHOT;
  private startPromise: Promise<TeamInboxSnapshot> | null = null;
  private cancelAuthRetry: (() => void) | null = null;

  constructor(dependencies: TeamInboxServiceDependencies) {
    this.dependencies = dependencies;
  }

  start(): Promise<TeamInboxSnapshot> {
    if (this.startPromise) return this.startPromise;
    if (this.fanIn) return Promise.resolve(this.snapshot);
    this.startPromise = this.startInternal().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  refresh(): Promise<TeamInboxSnapshot> {
    this.destroyFanIn();
    return this.start();
  }

  getSnapshot(): TeamInboxSnapshot {
    return this.snapshot;
  }

  subscribe(listener: (snapshot: TeamInboxSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  subscribeNewDelivery(
    listener: (delivery: TeamInboxSnapshot['deliveries'][number]) => void,
  ): () => void {
    this.deliveryListeners.add(listener);
    return () => { this.deliveryListeners.delete(listener); };
  }

  async markRead(deliveryIds: string[]): Promise<void> {
    if (!this.fanIn) throw new Error('Team inbox has not started');
    await this.fanIn.markRead(deliveryIds);
  }

  async dismiss(deliveryId: string): Promise<void> {
    if (!this.fanIn) throw new Error('Team inbox has not started');
    await this.fanIn.dismiss(deliveryId);
  }

  async claimAgentDelivery(deliveryId: string, sessionId: string): Promise<boolean> {
    if (!this.fanIn) throw new Error('Team inbox has not started');
    return this.fanIn.claimAgentDelivery(deliveryId, sessionId);
  }

  async completeAgentDelivery(deliveryId: string, sessionId: string): Promise<boolean> {
    if (!this.fanIn) throw new Error('Team inbox has not started');
    return this.fanIn.completeAgentDelivery(deliveryId, sessionId);
  }

  setPresenceStatus(status: PresenceDesiredStatus): void {
    this.fanIn?.setPresenceStatus(status);
  }

  destroy(): void {
    this.cancelAuthRetry?.();
    this.cancelAuthRetry = null;
    this.destroyFanIn();
    this.snapshot = DEFAULT_SNAPSHOT;
  }

  private destroyFanIn(): void {
    this.fanInCleanup?.();
    this.fanInCleanup = null;
    this.fanIn?.destroy();
    this.fanIn = null;
  }

  /**
   * True when the caller is too early and a retry has been armed instead.
   *
   * Starting unauthenticated is not merely a slow start — it is a permanent
   * one. `listOrganizations` returns `[]` before Stytch initializes, the fan-in
   * comes up with no rooms, and `start()` then short-circuits on the fan-in it
   * already has, so the inbox stays empty for the rest of the run: no
   * notifications, no agent mention wakes, no feedback-request quorum wakes.
   * It reports `status: 'ready'` throughout, which is indistinguishable from a
   * healthy inbox with nothing waiting, so nothing surfaces the failure.
   */
  private deferUntilAuthenticated(): boolean {
    const isAuthenticated = this.dependencies.isAuthenticated;
    const onAuthStateChange = this.dependencies.onAuthStateChange;
    if (!isAuthenticated || !onAuthStateChange || isAuthenticated()) return false;
    // An earlier deferral is still armed; a second caller must not add another.
    if (this.cancelAuthRetry) return true;
    // Safe to assign after subscribing: `onAuthStateChange` notifies
    // synchronously with the current state, and that state is unauthenticated —
    // we just checked — so the listener cannot have run before this returns.
    this.cancelAuthRetry = onAuthStateChange((state) => {
      if (!state.isAuthenticated) return;
      const unsubscribe = this.cancelAuthRetry;
      this.cancelAuthRetry = null;
      unsubscribe?.();
      void this.start().catch(() => {});
    });
    return true;
  }

  private async startInternal(): Promise<TeamInboxSnapshot> {
    if (this.deferUntilAuthenticated()) return this.snapshot;
    const teams = (await this.dependencies.listOrganizations())
      .filter(activeOrganization);
    const concurrency = this.dependencies.connectConcurrency
      ?? DEFAULT_TEAM_INBOX_CONNECT_CONCURRENCY;
    const resolved = await mapWithConcurrency<TeamDetails, ResolvedInboxOrganization>(
      teams,
      concurrency,
      async (team) => {
        try {
          const getTeamJwtForOrg = () =>
            this.dependencies.getTeamJwt(
              team.orgId,
              team.boundPersonalOrgId ?? team.sourcePersonalOrgId,
            );
          const jwt = await getTeamJwtForOrg();
          const memberId = this.dependencies.getTeamMemberId(jwt);
          if (!memberId) {
            throw new Error(
              `Team JWT for ${team.orgId} is missing its member id`,
            );
          }
          return {
            descriptor: {
              orgId: team.orgId,
              orgName: team.name,
              teamMemberId: asTeamMemberId(memberId),
            } satisfies TeamInboxOrgDescriptor,
            getTeamJwtForOrg,
          };
        } catch (error) {
          return {
            descriptor: {
              orgId: team.orgId,
              orgName: team.name,
              teamMemberId: asTeamMemberId(
                team.teamMemberId ?? `unresolved:${team.orgId}`,
              ),
            } satisfies TeamInboxOrgDescriptor,
            resolutionError:
              error instanceof Error ? error.message : String(error),
          };
        }
      },
    );

    this.destroyFanIn();
    this.fanIn = new TeamInboxFanIn({
      connectConcurrency: concurrency,
      onDelivery: (delivery) => {
        for (const listener of this.deliveryListeners) listener(delivery);
      },
      createClient: (org) => {
        const entry = resolved.find(
          (candidate) => candidate.descriptor.orgId === org.orgId,
        );
        if (!entry) {
          throw new Error(`Missing inbox JWT resolver for ${org.orgId}`);
        }
        if (typeof entry.resolutionError === 'string') {
          return createFailedOrgClient(org, entry.resolutionError);
        }
        const getTeamJwtForOrg = entry.getTeamJwtForOrg;
        if (!getTeamJwtForOrg) {
          throw new Error(`Missing inbox JWT resolver for ${org.orgId}`);
        }
        return this.dependencies.createOrgClient
          ? this.dependencies.createOrgClient(org, getTeamJwtForOrg)
          : new TeamInboxOrgClient({
              serverUrl: this.dependencies.getServerUrl(),
              org,
              getTeamJwt: getTeamJwtForOrg,
              getPresenceStatus: () =>
                getSettingsService().get('team.presence.status'),
            });
      },
    });
    this.fanInCleanup = this.fanIn.subscribe(() => {
      this.publish(this.fanIn!.getSnapshot());
    });
    await this.fanIn.start(resolved.map((entry) => entry.descriptor));
    this.publish(this.fanIn.getSnapshot());
    return this.snapshot;
  }

  private publish(snapshot: TeamInboxSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener(snapshot);
  }
}

let service: TeamInboxService | null = null;

export function getTeamInboxService(): TeamInboxService {
  if (!service) {
    service = new TeamInboxService({
      listOrganizations: listTeams,
      getTeamJwt: getOrgScopedJwt,
      getServerUrl: getCollabSyncHttpUrl,
      getTeamMemberId: getSubFromJwt,
      isAuthenticated,
      onAuthStateChange,
    });
  }
  return service;
}

export function shutdownTeamInboxService(): void {
  service?.destroy();
  service = null;
}

function createFailedOrgClient(
  org: TeamInboxOrgDescriptor,
  message: string,
): TeamInboxOrgClientLike {
  const listeners = new Set<
    Parameters<TeamInboxOrgClientLike['subscribe']>[0]
  >();
  return {
    org,
    async connect() {
      for (const listener of listeners) {
        listener({
          type: 'error',
          code: 'TEAM_INBOX_AUTH_FAILED',
          message,
        });
      }
    },
    async markRead() {
      throw new Error(message);
    },
    async dismiss() {
      throw new Error(message);
    },
    async claimAgentDelivery() {
      throw new Error(message);
    },
    async completeAgentDelivery() {
      throw new Error(message);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    destroy() {
      listeners.clear();
    },
  };
}
