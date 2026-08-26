import type { TeamJwt, TeamMemberId } from '@nimbalyst/runtime/auth/jwtScopes';
import type { TrackerItem, TrackerIdentity } from '@nimbalyst/runtime/core/DocumentService';
import { trackerRecordToItem, type TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
// Deep paths, not the `@nimbalyst/runtime/sync` barrel: that barrel also
// re-exports the revision-snapshot bridge and the session store, which reach
// `@nimbalyst/extension-sdk` and `runtime/src/ai/server/` -- both forbidden in a
// browser entry, and both otherwise invisible until the bundle gate fails.
import {
  IndexedDbTrackerPersistence,
  type StoredTrackerItem,
} from '@nimbalyst/runtime/sync/trackerPersistence';
import { projectLabelsToValues } from '@nimbalyst/runtime/sync/trackerLabels';
import {
  buildTrackerRoomId,
  type TrackerItemPayload,
} from '@nimbalyst/runtime/sync/trackerProtocol';
import {
  TrackerSyncEngine,
  type TrackerNavigationSyncHooks,
  type TrackerPresenceIdentity,
  type TrackerSchemaSyncHooks,
  type TrackerSyncEngineConfig,
} from '@nimbalyst/runtime/sync/TrackerSyncEngine';
import type { TrackerAccessTermination } from '@nimbalyst/runtime/sync/trackerAccessTermination';
import type {
  TrackerBatchUpdateInput,
  TrackerCreateItemInput,
  TrackerDataChange,
  TrackerDataCommand,
  TrackerDataCommandResult,
  TrackerDataSnapshot,
  TrackerDataSource,
  TrackerSavedViewRecord,
  TrackerSyncState,
  TrackerUpdateItemInput,
} from '../dataSource';

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

const BROWSER_MUTATION_ERROR = 'Browser trackers only support team-shared mutations';
const TRACKER_DATABASE_PREFIX = 'nimbalyst-tracker-v1:';

function trackerDatabaseName(orgId: string, teamProjectId: string): string {
  return `${TRACKER_DATABASE_PREFIX}${orgId}:${teamProjectId}`;
}

async function purgeTrackerDatabases(
  predicate: (databaseName: string) => boolean,
  indexedDbFactory: IDBFactory = globalThis.indexedDB,
): Promise<void> {
  const databases = await indexedDbFactory.databases();
  const names = databases
    .map(database => database.name)
    .filter((name): name is string => typeof name === 'string' && predicate(name));
  await Promise.all(names.map(async databaseName => {
    const persistence = new IndexedDbTrackerPersistence(databaseName, indexedDbFactory);
    try {
      await persistence.purgeAll();
    } finally {
      await persistence.close();
    }
  }));
}

/** Purge a room cache even when authorization fails before a data source mounts. */
export async function purgeBrowserTrackerRoom(
  orgId: string,
  teamProjectId: string,
  indexedDbFactory?: IDBFactory,
): Promise<void> {
  const persistence = new IndexedDbTrackerPersistence(
    trackerDatabaseName(orgId, teamProjectId),
    indexedDbFactory,
  );
  try {
    await persistence.purgeAll();
  } finally {
    await persistence.close();
  }
}

/** Purge every cached tracker project for a removed organization member. */
export async function purgeBrowserTrackerOrganization(
  orgId: string,
  indexedDbFactory?: IDBFactory,
): Promise<void> {
  const prefix = `${TRACKER_DATABASE_PREFIX}${orgId}:`;
  await purgeTrackerDatabases(name => name.startsWith(prefix), indexedDbFactory);
}

/** Purge all tracker data when the browser team session itself is gone. */
export async function purgeAllBrowserTrackerData(indexedDbFactory?: IDBFactory): Promise<void> {
  await purgeTrackerDatabases(name => name.startsWith(TRACKER_DATABASE_PREFIX), indexedDbFactory);
}

function assertBrowserMutation(
  sharing: 'personal' | 'team' | undefined,
  draftByDefault: boolean | undefined,
): void {
  if (sharing === 'personal') throw new Error(`${BROWSER_MUTATION_ERROR}; personal sharing is unavailable`);
  if (draftByDefault) throw new Error(`${BROWSER_MUTATION_ERROR}; local drafts are unavailable`);
}

function payloadToItem(stored: StoredTrackerItem, workspacePath: string): TrackerItem | null {
  const { envelope, payload } = stored;
  if (!payload || envelope.encryptedPayload === null) return null;
  const now = new Date(envelope.updatedAt).toISOString();
  const fields = {
    ...payload.fields,
    labels: projectLabelsToValues(payload.labels),
  };
  const record: TrackerRecord = {
    id: payload.itemId,
    primaryType: payload.primaryType,
    typeTags: [payload.primaryType],
    issueNumber: payload.issueNumber ?? envelope.issueNumber,
    issueKey: payload.issueKey ?? envelope.issueKey,
    source: 'native',
    archived: payload.archived,
    syncStatus: envelope.syncId > 0 ? 'synced' : 'pending',
    content: undefined,
    system: {
      workspace: workspacePath,
      createdAt: payload.system.createdAt ?? now,
      updatedAt: payload.system.updatedAt ?? now,
      lastIndexed: now,
      authorIdentity: payload.system.authorIdentity ?? null,
      lastModifiedBy: payload.system.lastModifiedBy ?? null,
      createdByAgent: payload.system.createdByAgent,
      linkedCommitSha: payload.system.linkedCommitSha,
      linkedCommits: payload.system.linkedCommits,
      linkedPullRequests: payload.system.linkedPullRequests,
      documentId: payload.system.documentId,
      origin: payload.system.origin,
      triagedAt: payload.system.triagedAt,
      triagedBy: payload.system.triagedBy,
      comments: payload.comments,
      activity: payload.activity,
    },
    fields,
  };
  const item = trackerRecordToItem(record);
  item.labelsMap = payload.labels;
  item.bodyVersion = payload.bodyVersion;
  return item;
}

function createPayload(item: TrackerCreateItemInput, currentUser: TrackerIdentity): TrackerItemPayload {
  const now = new Date().toISOString();
  return {
    itemId: item.id,
    primaryType: item.type,
    archived: false,
    bodyVersion: 0,
    fields: {
      ...(item.customFields ?? {}),
      title: item.title,
      status: item.status,
      priority: item.priority,
      ...(item.description === undefined ? {} : { description: item.description }),
      ...(item.owner === undefined ? {} : { owner: item.owner }),
      ...(item.tags === undefined ? {} : { tags: item.tags }),
    },
    labels: {},
    comments: [],
    system: {
      authorIdentity: currentUser,
      lastModifiedBy: currentUser,
      createdAt: now,
      updatedAt: now,
    },
  };
}

function updatePayload(
  payload: TrackerItemPayload,
  updates: Record<string, unknown>,
  currentUser: TrackerIdentity,
): TrackerItemPayload {
  const fields = { ...payload.fields, ...updates };
  const primaryType = typeof updates.type === 'string'
    ? updates.type
    : typeof updates.primaryType === 'string'
      ? updates.primaryType
      : payload.primaryType;
  const archived = typeof updates.archived === 'boolean' ? updates.archived : payload.archived;
  const bodyVersion = typeof updates.bodyVersion === 'number' ? updates.bodyVersion : payload.bodyVersion;
  for (const key of ['type', 'primaryType', 'archived', 'bodyVersion']) delete fields[key];
  return {
    ...payload,
    primaryType,
    archived,
    bodyVersion,
    fields,
    system: {
      ...payload.system,
      lastModifiedBy: currentUser,
      updatedAt: new Date().toISOString(),
    },
  };
}

export class BrowserTrackerDataSource implements TrackerDataSource {
  private readonly persistence: IndexedDbTrackerPersistence;
  private readonly engine: TrackerSyncEngine;
  private readonly listeners = new Set<(change: TrackerDataChange) => void>();
  private syncState: TrackerSyncState;
  /** Cached projections stay sealed until the current member passes the room gate. */
  private authorized = false;
  private disposed = false;

  private get transactionOwner() {
    return {
      orgId: this.options.orgId,
      teamProjectId: this.options.teamProjectId,
      teamMemberId: this.options.teamMemberId,
    };
  }

  constructor(private readonly options: BrowserTrackerDataSourceOptions) {
    this.persistence = options.persistence ?? new IndexedDbTrackerPersistence(
      options.databaseName ?? trackerDatabaseName(options.orgId, options.teamProjectId),
      options.indexedDbFactory,
    );
    this.syncState = {
      workspacePath: options.workspacePath,
      status: 'disconnected',
      projectId: options.teamProjectId,
      access: null,
    };

    const engineConfig: TrackerSyncEngineConfig = {
      serverUrl: options.serverUrl,
      orgId: options.orgId,
      teamProjectId: options.teamProjectId,
      teamMemberId: options.teamMemberId,
      persistence: this.persistence,
      getJwt: async () => {
        try {
          return await options.getTeamJwt();
        } catch (error) {
          const termination = options.classifyAuthFailure?.(error) ?? null;
          if (termination) this.engine.terminateAccess(termination);
          throw error;
        }
      },
      authorizeConnection: options.authorizeRoom ?? (jwt => this.authorizeRoom(jwt)),
      onAuthorized: () => {
        this.authorized = true;
        void this.emitAuthorizedProjection();
      },
      presenceIdentity: options.presenceIdentity,
      schemaSync: options.schemaSync,
      navigationSync: options.navigationSync,
      initializeIssueKeyPrefix: options.initializeIssueKeyPrefix,
      ...(options.createWebSocket ? { createWebSocket: options.createWebSocket } : {}),
      savedViewSync: {
        getMaxSyncId: () => this.persistence.getMaxSavedViewSyncId(),
        listUnsynced: async () => (await this.persistence.listSavedViews())
          .filter(view => view.unsynced && this.savedViewBelongsToCurrentMember(view.owner))
          .map(view => ({ viewId: view.viewId, payload: view.payload, deleted: view.deleted })),
        applyRemote: async ({ viewId, payload, syncId }) => {
          await this.persistence.applyRemoteSavedView(viewId, payload, syncId);
          await this.emitSavedViews();
        },
        markRejected: async (viewId, code) => {
          await this.persistence.markSavedViewRejected(viewId, code);
          await this.emitSavedViews();
        },
      },
      onStatusChange: status => {
        // Read the refusal back off the engine rather than assuming an
        // ordering between the two callbacks: a status event that omitted a
        // termination already recorded would tell the surface to keep waiting.
        this.setSyncState({ status, access: this.engine.getAccessTermination() });
      },
      // `setStatus` is edge-triggered, so a refusal arriving while the status
      // is already `error` emits nothing. This is what guarantees the surface
      // hears about it exactly once.
      onAccessTerminated: termination => {
        void this.handleAccessTerminated(termination);
      },
      onPresenceChange: members => {
        this.emit({ type: 'presence', members: [...members] });
      },
      onItemApplied: applied => {
        void this.emitAppliedItem(applied.itemId, applied.isTombstone);
      },
      onConfigChange: config => {
        this.emit({
          type: 'config-changed',
          workspacePath: options.workspacePath,
          config: { issueKeyPrefix: config.issueKeyPrefix },
        });
      },
      onRejection: rejection => {
        this.emit({
          type: 'mutation-rejected',
          rejection: {
            workspacePath: options.workspacePath,
            itemId: rejection.itemId,
            clientMutationId: rejection.clientMutationId,
            code: rejection.rejection.code,
            message: rejection.rejection.message,
          },
        });
        void this.emitAppliedItem(rejection.itemId, false);
      },
      onBootstrapError: error => options.reportError?.(error, 'tracker bootstrap'),
      onServerError: error => options.reportError?.(error, 'tracker server'),
    };
    this.engine = new TrackerSyncEngine(engineConfig);
    void this.engine.connect().catch(error => options.reportError?.(error, 'tracker connect'));
  }

  async snapshot(): Promise<TrackerDataSnapshot> {
    this.assertActive();
    if (!this.authorized) {
      return { items: [], savedViews: [], presence: [], sync: this.syncState };
    }
    const [items, savedViews] = await Promise.all([this.readItems(), this.readSavedViews()]);
    if (!this.authorized) {
      return { items: [], savedViews: [], presence: [], sync: this.syncState };
    }
    return { items, savedViews, presence: this.engine.getPresence(), sync: this.syncState };
  }

  subscribe(cb: (change: TrackerDataChange) => void): () => void {
    this.assertActive();
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  status(): TrackerSyncState {
    return this.syncState;
  }

  async command(command: TrackerDataCommand): Promise<TrackerDataCommandResult> {
    this.assertActive();
    if (
      command.type !== 'list-items'
      && command.type !== 'refresh-items'
      && command.type !== 'reconnect'
    ) {
      this.assertAuthorized();
    }
    switch (command.type) {
      case 'list-items':
      case 'refresh-items':
        return { ok: true, items: await this.readItems() };
      case 'create-item':
        assertBrowserMutation(command.item.sharing, command.item.draftByDefault);
        if (command.item.content !== undefined) {
          throw new Error('Tracker body content must be written through its collaborative document room');
        }
        return {
          ok: true,
          result: await this.upsert(createPayload(command.item, this.options.currentUser)),
        };
      case 'update-item':
        return { ok: true, result: await this.updateOne(command.input) };
      case 'update-items':
        return { ok: true, result: await this.updateMany(command.input) };
      case 'archive-item':
        return {
          ok: true,
          result: await this.updateExisting(
            command.itemId,
            payload => ({ ...payload, archived: command.archive }),
          ),
        };
      case 'delete-item': {
        const result = await this.engine.deleteItem(command.itemId, { persistedEnqueue: true });
        this.emit({ type: 'items-removed', itemIds: [command.itemId] });
        return { ok: true, result };
      }
      case 'update-item-content':
        throw new Error('Tracker body content must be written through its collaborative document room');
      case 'add-comment':
        return {
          ok: true,
          result: await this.updateExisting(command.itemId, payload => ({
            ...payload,
            comments: [...payload.comments, {
              id: crypto.randomUUID(),
              authorIdentity: this.options.currentUser,
              body: command.body,
              createdAt: Date.now(),
            }],
          })),
        };
      case 'update-comment':
        return {
          ok: true,
          result: await this.updateExisting(command.itemId, payload => ({
            ...payload,
            comments: payload.comments.map(comment => comment.id === command.commentId
              ? {
                  ...comment,
                  ...(command.body === undefined ? {} : { body: command.body }),
                  ...(command.deleted === undefined ? {} : { deleted: command.deleted || undefined }),
                  updatedAt: Date.now(),
                }
              : comment),
          })),
        };
      case 'share-saved-view':
        await this.persistence.putLocalSavedView(
          command.savedView.viewId,
          command.savedView.payload,
          this.transactionOwner,
        );
        await this.emitSavedViews();
        await this.engine.flushSavedViews();
        return { ok: true, savedViews: await this.readSavedViews() };
      case 'unshare-saved-view':
        await this.persistence.putLocalSavedView(command.viewId, null, this.transactionOwner);
        await this.emitSavedViews();
        await this.engine.flushSavedViews();
        return { ok: true, savedViews: await this.readSavedViews() };
      case 'reconnect': {
        // Fail loudly rather than reporting a reconnect that the engine will
        // decline: a caller offering "try again" over a revocation is the
        // stuck-spinner bug wearing a button.
        const access = this.engine.getAccessTermination();
        if (access) throw new Error(`Tracker room access ended: ${access.message}`);
        this.engine.disconnect();
        await this.engine.connect();
        return { ok: true };
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.engine.destroy();
    this.listeners.clear();
    void this.persistence.close();
  }

  private async updateOne(input: TrackerUpdateItemInput): Promise<{ clientMutationId: string }> {
    assertBrowserMutation(input.sharing, input.draftByDefault);
    return this.updateExisting(input.itemId, payload => updatePayload(
      payload,
      input.updates,
      this.options.currentUser,
    ));
  }

  private async updateMany(input: TrackerBatchUpdateInput): Promise<{ clientMutationIds: string[] }> {
    for (const entry of input.entries) {
      assertBrowserMutation(entry.sharing, entry.draftByDefault);
      if (entry.fileUpdates && Object.keys(entry.fileUpdates).length > 0) {
        throw new Error('Browser trackers cannot apply filesystem-backed updates');
      }
    }
    const entries = input.entries.filter(entry => entry.storeUpdates);
    if (entries.length === 0) return { clientMutationIds: [] };
    const storedItems = await this.persistence.getItems(entries.map(entry => entry.itemId));
    const payloads = storedItems.map((stored, index) => {
      if (!stored?.payload || stored.envelope.encryptedPayload === null) {
        throw new Error(`Tracker item not found: ${entries[index].itemId}`);
      }
      return updatePayload(
        stored.payload,
        entries[index].storeUpdates ?? {},
        this.options.currentUser,
      );
    });
    const result = await this.engine.upsertItems(payloads);
    const items = payloads.map((payload, index) => payloadToItem({
      envelope: storedItems[index]!.envelope,
      payload,
    }, this.options.workspacePath)).filter((item): item is TrackerItem => item !== null);
    this.emit({ type: 'items-upserted', items });
    return result;
  }

  private async updateExisting(
    itemId: string,
    update: (payload: TrackerItemPayload) => TrackerItemPayload,
  ): Promise<{ clientMutationId: string }> {
    const stored = await this.persistence.getItem(itemId);
    if (!stored?.payload || stored.envelope.encryptedPayload === null) {
      throw new Error(`Tracker item not found: ${itemId}`);
    }
    const next = update(stored.payload);
    next.system = {
      ...next.system,
      lastModifiedBy: this.options.currentUser,
      updatedAt: new Date().toISOString(),
    };
    return this.upsert(next);
  }

  private async upsert(payload: TrackerItemPayload): Promise<{ clientMutationId: string }> {
    const result = await this.engine.upsertItem(payload, { persistedEnqueue: true });
    await this.emitAppliedItem(payload.itemId, false);
    return result;
  }

  private async readItems(): Promise<TrackerItem[]> {
    if (!this.authorized) return [];
    const storedItems = await this.persistence.listItems();
    if (!this.authorized) return [];
    return storedItems
      .map(stored => payloadToItem(stored, this.options.workspacePath))
      .filter((item): item is TrackerItem => item !== null);
  }

  private async readSavedViews(): Promise<TrackerSavedViewRecord[]> {
    if (!this.authorized) return [];
    const storedViews = await this.persistence.listSavedViews();
    if (!this.authorized) return [];
    return storedViews
      .filter(view => (
        !view.deleted
        && view.payload !== null
        && (!view.unsynced || this.savedViewBelongsToCurrentMember(view.owner))
      ))
      .map(view => ({ viewId: view.viewId, payload: view.payload! }));
  }

  private async emitAppliedItem(itemId: string, tombstone: boolean): Promise<void> {
    if (this.disposed || !this.authorized) return;
    if (tombstone) {
      this.emit({ type: 'items-removed', itemIds: [itemId] });
      return;
    }
    const stored = await this.persistence.getItem(itemId);
    if (this.disposed || !this.authorized) return;
    const item = stored ? payloadToItem(stored, this.options.workspacePath) : null;
    if (item) this.emit({ type: 'items-upserted', items: [item] });
    else this.emit({ type: 'items-removed', itemIds: [itemId] });
  }

  private async emitSavedViews(): Promise<void> {
    if (this.disposed) return;
    this.emit({ type: 'saved-views-replaced', savedViews: await this.readSavedViews() });
  }

  /**
   * A plain GET reaches the exact worker authorization gate used by the
   * WebSocket upgrade. Authorized requests continue to TrackerRoom and answer
   * 400 "Expected WebSocket"; 401/403 are returned before a socket exists.
   */
  private async authorizeRoom(jwt: TeamJwt): Promise<TrackerAccessTermination | null> {
    const roomId = buildTrackerRoomId(this.options.orgId, this.options.teamProjectId);
    const url = new URL(`${this.options.serverUrl}/sync/${roomId}`);
    if (url.protocol === 'wss:') url.protocol = 'https:';
    else if (url.protocol === 'ws:') url.protocol = 'http:';
    url.searchParams.set('token', jwt);
    const response = await fetch(url);
    if (response.status === 400) return null;
    const message = await response.text();
    if (response.status === 401) {
      return {
        reason: 'signed-out',
        message: message || 'Your team session is no longer authorized.',
      };
    }
    if (response.status === 403) {
      return {
        reason: 'tracker-access-revoked',
        message: message || 'Your access to this tracker was revoked.',
      };
    }
    throw new Error(`Tracker authorization probe failed with HTTP ${response.status}`);
  }

  private async emitAuthorizedProjection(): Promise<void> {
    if (this.disposed || !this.authorized) return;
    const [items, savedViews] = await Promise.all([this.readItems(), this.readSavedViews()]);
    if (this.disposed || !this.authorized) return;
    this.emit({ type: 'items-replaced', items });
    this.emit({ type: 'saved-views-replaced', savedViews });
  }

  private async handleAccessTerminated(termination: TrackerAccessTermination): Promise<void> {
    this.authorized = false;
    this.setSyncState({ status: 'error', access: termination });
    // Clear the rendered projection synchronously before the IndexedDB clear
    // completes, so a revoked reader cannot retain rows during storage I/O.
    this.emit({ type: 'items-replaced', items: [] });
    this.emit({ type: 'saved-views-replaced', savedViews: [] });
    try {
      await this.persistence.purgeAll();
    } catch (error) {
      this.options.reportError?.(error, 'tracker access purge');
    }
  }

  private setSyncState(patch: Partial<TrackerSyncState>): void {
    const next = { ...this.syncState, ...patch };
    if (
      next.status === this.syncState.status
      && next.access === this.syncState.access
    ) return;
    this.syncState = next;
    this.emit({ type: 'status', sync: this.syncState });
  }

  private emit(change: TrackerDataChange): void {
    if (this.disposed) return;
    for (const listener of this.listeners) listener(change);
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('Tracker data source has been disposed');
  }

  private assertAuthorized(): void {
    if (!this.authorized) throw new Error('Tracker room authorization has not completed');
  }

  private savedViewBelongsToCurrentMember(
    owner: { orgId: string; teamProjectId: string; teamMemberId: string } | undefined,
  ): boolean {
    return owner?.orgId === this.options.orgId
      && owner.teamProjectId === this.options.teamProjectId
      && owner.teamMemberId === this.options.teamMemberId;
  }
}
