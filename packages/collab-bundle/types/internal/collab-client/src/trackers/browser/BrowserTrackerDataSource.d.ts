import type { TeamJwt, TeamMemberId } from '../../../../runtime/src/auth/jwtScopes';
import type { TrackerIdentity } from '../../../../runtime/src/core/DocumentService';
import { IndexedDbTrackerPersistence } from '../../../../runtime/src/sync/trackerPersistence';
import { type TrackerNavigationSyncHooks, type TrackerPresenceIdentity, type TrackerSchemaSyncHooks } from '../../../../runtime/src/sync/TrackerSyncEngine';
import type { TrackerAccessTermination } from '../../../../runtime/src/sync/trackerAccessTermination';
import type { TrackerDataChange, TrackerDataCommand, TrackerDataCommandResult, TrackerDataSnapshot, TrackerDataSource, TrackerSyncState } from '../dataSource';
export interface BrowserTrackerDataSourceOptions {
    workspacePath: string;
    serverUrl: string;
    orgId: string;
    teamProjectId: string;
    teamMemberId: TeamMemberId;
    currentUser: TrackerIdentity;
    /** Display identity from the team roster. Do not derive this from email. */
    presenceIdentity: TrackerPresenceIdentity;
    getTeamJwt: () => Promise<TeamJwt>;
    databaseName?: string;
    indexedDbFactory?: IDBFactory;
    persistence?: IndexedDbTrackerPersistence;
    schemaSync?: TrackerSchemaSyncHooks;
    navigationSync?: TrackerNavigationSyncHooks;
    initializeIssueKeyPrefix?: string;
    /** Browser hosts omit this; local harnesses may inject a socket implementation. */
    createWebSocket?: (url: string) => WebSocket;
    /** Test seam for a harness that has no HTTP worker in front of its fake room. */
    authorizeRoom?: (jwt: TeamJwt) => Promise<TrackerAccessTermination | null>;
    /**
     * Decide whether a failure to mint a team JWT is terminal, and say which
     * terminal thing it is. Return null for anything retryable.
     *
     * Without it, an expired session is indistinguishable from a flaky network:
     * the engine retries with backoff, the surface shows "offline", and the
     * reader is never told to sign in -- the documented first thing to check when
     * a second client cannot see shared data. Left unset, every token failure
     * stays on the retry path, which is the right default for a host whose auth
     * errors it cannot classify.
     */
    classifyAuthFailure?: (error: unknown) => TrackerAccessTermination | null;
    reportError?: (error: unknown, context: string) => void;
}
/** Purge a room cache even when authorization fails before a data source mounts. */
export declare function purgeBrowserTrackerRoom(orgId: string, teamProjectId: string, indexedDbFactory?: IDBFactory): Promise<void>;
/** Purge every cached tracker project for a removed organization member. */
export declare function purgeBrowserTrackerOrganization(orgId: string, indexedDbFactory?: IDBFactory): Promise<void>;
/** Purge all tracker data when the browser team session itself is gone. */
export declare function purgeAllBrowserTrackerData(indexedDbFactory?: IDBFactory): Promise<void>;
export declare class BrowserTrackerDataSource implements TrackerDataSource {
    private readonly options;
    private readonly persistence;
    private readonly engine;
    private readonly listeners;
    private syncState;
    /** Cached projections stay sealed until the current member passes the room gate. */
    private authorized;
    private disposed;
    private get transactionOwner();
    constructor(options: BrowserTrackerDataSourceOptions);
    snapshot(): Promise<TrackerDataSnapshot>;
    subscribe(cb: (change: TrackerDataChange) => void): () => void;
    status(): TrackerSyncState;
    command(command: TrackerDataCommand): Promise<TrackerDataCommandResult>;
    dispose(): void;
    private updateOne;
    private updateMany;
    private updateExisting;
    private upsert;
    private readItems;
    private readSavedViews;
    private emitAppliedItem;
    private emitSavedViews;
    /**
     * A plain GET reaches the exact worker authorization gate used by the
     * WebSocket upgrade. Authorized requests continue to TrackerRoom and answer
     * 400 "Expected WebSocket"; 401/403 are returned before a socket exists.
     */
    private authorizeRoom;
    private emitAuthorizedProjection;
    private handleAccessTerminated;
    private setSyncState;
    private emit;
    private assertActive;
    private assertAuthorized;
    private savedViewBelongsToCurrentMember;
}
