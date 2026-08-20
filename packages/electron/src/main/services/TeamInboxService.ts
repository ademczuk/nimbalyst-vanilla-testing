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
import { logger } from '../utils/logger';
import { getSettingsService } from './SettingsService';
import { getSubFromJwt } from './jwtOrg';
import { isAuthenticated, onAuthStateChange } from './StytchAuthService';
import {
  getOrgScopedJwt,
  listTeamDirectory,
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
  /** Backoff schedule for a team directory that is not fetchable yet. */
  directoryRetryDelaysMs?: readonly number[];
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

const AUTH_NOT_READY_MESSAGE = 'Not authenticated. Sign in first.';

/**
 * Backoff for a team directory that is not fetchable yet, roughly a minute in
 * total.
 *
 * The signal that matters is the directory's own `complete`, not an auth-state
 * transition: Stytch reports a restored session well before `/api/teams` can be
 * fetched against it, so on a cold start there is no future auth event to wake
 * on and a listener-only retry parks the inbox in `loading` for the life of the
 * run. Auth transitions still accelerate this schedule; they no longer replace
 * it.
 */
const DEFAULT_DIRECTORY_RETRY_DELAYS_MS = [
  500, 1000, 2000, 4000, 8000, 15000, 30000,
] as const;

function isAuthNotReadyError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(AUTH_NOT_READY_MESSAGE);
}

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
  private retryStartAfterSettle = false;
  private directoryRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private directoryRetryAttempt = 0;

  constructor(dependencies: TeamInboxServiceDependencies) {
    this.dependencies = dependencies;
  }

  start(): Promise<TeamInboxSnapshot> {
    if (this.startPromise) return this.startPromise;
    if (this.fanIn) return Promise.resolve(this.snapshot);
    this.startPromise = Promise.resolve()
      .then(() => this.startInternal())
      .finally(() => {
        this.startPromise = null;
        if (this.retryStartAfterSettle) {
          this.retryStartAfterSettle = false;
          void this.start().catch(() => {});
        }
      });
    return this.startPromise;
  }

  refresh(): Promise<TeamInboxSnapshot> {
    // An explicit refresh is a fresh chance, not the next step of a schedule
    // that may already have run out.
    this.clearDirectoryRetry();
    this.directoryRetryAttempt = 0;
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
    this.retryStartAfterSettle = false;
    this.clearDirectoryRetry();
    this.directoryRetryAttempt = 0;
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
   * True when the caller is too early and a sign-in wake has been armed.
   *
   * Starting unauthenticated is not merely a slow start — it is a permanent
   * one. `listOrganizations` returns `[]` before Stytch initializes, the fan-in
   * comes up with no rooms, and `start()` then short-circuits on the fan-in it
   * already has, so the inbox stays empty for the rest of the run: no
   * notifications, no agent mention wakes, no feedback-request quorum wakes.
   * It reports `status: 'ready'` throughout, which is indistinguishable from a
   * healthy inbox with nothing waiting, so nothing surfaces the failure.
   *
   * This only observes "Stytch has no session". It is an accelerator, never the
   * whole retry story: a restored session can be visible here while the team
   * directory is still unfetchable, and no further auth event is coming to wake
   * the caller. The backoff schedule is what covers that gap.
   */
  private deferUntilAuthenticated(): boolean {
    const isAuthenticated = this.dependencies.isAuthenticated;
    const onAuthStateChange = this.dependencies.onAuthStateChange;
    if (!isAuthenticated || !onAuthStateChange) return false;
    if (isAuthenticated()) return false;
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
      // A real sign-in is new information, so the schedule starts over even if
      // an earlier one had run out.
      this.clearDirectoryRetry();
      this.directoryRetryAttempt = 0;
      this.requestStartRetry();
    });
    return true;
  }

  private requestStartRetry(): void {
    if (this.startPromise) {
      this.retryStartAfterSettle = true;
      return;
    }
    void this.start().catch(() => {});
  }

  private clearDirectoryRetry(): void {
    if (!this.directoryRetryTimer) return;
    clearTimeout(this.directoryRetryTimer);
    this.directoryRetryTimer = null;
  }

  /**
   * Arms the next backoff attempt, or reports the schedule exhausted.
   *
   * Bounded so a directory that never becomes fetchable stops costing wakeups;
   * a later sign-in, or an explicit `refresh()`, resets it.
   */
  private scheduleDirectoryRetry(): boolean {
    const delays = this.dependencies.directoryRetryDelaysMs
      ?? DEFAULT_DIRECTORY_RETRY_DELAYS_MS;
    const delay = delays[this.directoryRetryAttempt];
    if (delay === undefined) return false;
    this.directoryRetryAttempt += 1;
    this.clearDirectoryRetry();
    this.directoryRetryTimer = setTimeout(() => {
      this.directoryRetryTimer = null;
      this.requestStartRetry();
    }, delay);
    this.directoryRetryTimer.unref?.();
    return true;
  }

  /**
   * Terminal state for a directory that stayed unfetchable for the whole
   * schedule.
   *
   * Deliberately not `ready` with an empty organization list: that is
   * indistinguishable from "you belong to no teams" and is exactly the silent
   * failure this service exists to avoid. Offline says the inbox could not be
   * loaded, which is the truth, and keeps whatever was already cached.
   */
  private publishDirectoryUnreachable(): void {
    this.publish({
      ...this.snapshot,
      status: this.snapshot.deliveries.length > 0
        ? 'offlineWithCache'
        : 'offlineWithoutCache',
    });
  }

  private async startInternal(): Promise<TeamInboxSnapshot> {
    let teams: TeamDetails[];
    try {
      // Signed out is asked about first so the common case never burns a
      // pointless directory fetch, but its failure path is the same one below.
      if (this.deferUntilAuthenticated()) throw new Error(AUTH_NOT_READY_MESSAGE);
      teams = (await this.dependencies.listOrganizations())
        .filter(activeOrganization);
    } catch (error) {
      if (!isAuthNotReadyError(error)) throw error;
      // The directory is not fetchable yet. Keep asking on a bounded schedule —
      // waiting on an auth transition instead is what parked the inbox in
      // `loading` forever, because on a cold start that transition already
      // happened before the first attempt.
      if (this.scheduleDirectoryRetry()) return this.snapshot;
      logger.main.warn(
        '[TeamInbox] Team directory never became fetchable; giving up until sign-in or refresh',
      );
      this.publishDirectoryUnreachable();
      return this.snapshot;
    }
    this.clearDirectoryRetry();
    this.directoryRetryAttempt = 0;
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
      listOrganizations: async () => {
        const directory = await listTeamDirectory();
        if (!directory.complete) throw new Error(AUTH_NOT_READY_MESSAGE);
        return directory.teams;
      },
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
