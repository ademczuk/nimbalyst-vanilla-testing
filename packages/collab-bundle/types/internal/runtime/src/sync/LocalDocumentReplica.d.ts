import * as Y from "yjs";
import type { LocalReplicaIdentity, LocalDocumentReplicaOutboxState, LocalReplicaStore, LocalReplicaUpdateSource } from "./LocalReplicaStore";
export type LocalDocumentReplicaState = "loading" | "ready" | "corrupt" | "unavailable";
export interface LocalDocumentReplicaOptions {
    identity: LocalReplicaIdentity;
    documentType: string;
    store: LocalReplicaStore;
    ydoc?: Y.Doc;
    onReplicaStateChange?: (state: LocalDocumentReplicaState) => void;
    onOutboxStateChange?: (state: LocalDocumentReplicaOutboxState) => void;
    onOfflineMetric?: (event: {
        metric: string;
        [property: string]: string | number | boolean | null;
    }) => void;
    compaction?: Partial<LocalReplicaCompactionOptions>;
}
export interface LocalReplicaCompactionOptions {
    updateCountThreshold: number;
    byteThreshold: number;
    idleIntervalMs: number;
    remotePersistenceWindowMs: number;
}
export interface ApplyRemoteReplicaUpdate {
    update: Uint8Array;
    source: Exclude<LocalReplicaUpdateSource, "local">;
    serverSequence: number | null;
}
export interface LocalReplicaReplayBatch {
    batchId: string;
    batchIds: string[];
    update: Uint8Array;
}
export declare const DEFAULT_LOCAL_REPLICA_COMPACTION: LocalReplicaCompactionOptions;
/**
 * Owns the in-memory Y.Doc and its durable local lifecycle. Editors and the
 * network provider attach independently to this object.
 */
export declare class LocalDocumentReplica {
    readonly identity: LocalReplicaIdentity;
    readonly documentType: string;
    readonly whenReady: Promise<void>;
    private readonly store;
    private readonly onReplicaStateChange?;
    private readonly onOutboxStateChange?;
    private readonly onOfflineMetric?;
    private readonly ydoc;
    private readonly compactionOptions;
    private readonly unsubscribeSiblingUpdates;
    private state;
    private snapshotGeneration;
    private lastServerSeq;
    private complete;
    private hydratedFromStore;
    private destroyed;
    private discarded;
    private repairingCorruption;
    private cleanHydrationRequired;
    private writeTail;
    private compactionTail;
    private idleCompactionTimer;
    private tailUpdateCount;
    private tailBytes;
    private remotePersistenceTimer;
    private remotePersistenceBuffer;
    private remotePersistenceCursor;
    private remotePersistencePromise;
    private outbox;
    private readonly updateHandler;
    constructor(options: LocalDocumentReplicaOptions);
    getYDoc(): Y.Doc;
    isInternalOrigin(origin: unknown): boolean;
    getState(): LocalDocumentReplicaState;
    getLastServerSeq(): number;
    isComplete(): boolean;
    needsCleanServerHydration(): boolean;
    wasHydratedFromStore(): boolean;
    hasPendingOutbox(): boolean;
    /** Host observability may bucket this count; runtime never emits analytics. */
    getOutboxEntryCount(): number;
    getOutboxState(): LocalDocumentReplicaOutboxState;
    getPendingOutboxUpdate(): Uint8Array | null;
    persistPendingOutboxUpdate(update: Uint8Array): Promise<string>;
    applyRemoteUpdates(updates: ApplyRemoteReplicaUpdate[], lastServerSeq: number, options?: {
        coalescePersistence?: boolean;
    }): Promise<boolean>;
    beginOutboxReplay(): Promise<LocalReplicaReplayBatch | null>;
    acknowledgeOutbox(batchIds: string[], serverSequence: number): Promise<void>;
    requeueOutbox(batchIds: string[]): Promise<void>;
    rejectOutbox(batchIds: string[], errorCode: string): Promise<void>;
    recordOutboxError(batchIds: string[], errorCode: string): Promise<void>;
    markIncomplete(): Promise<void>;
    /**
     * Prepares a corrupt or incomplete replica for a full server replay without
     * discarding rejected/queued local edits. The visible error state remains
     * until a complete server hydration is durably applied.
     */
    beginCleanServerHydration(): Promise<void>;
    completeCleanServerHydration(complete: boolean): Promise<void>;
    discardLocalCopy(): Promise<void>;
    flush(): Promise<void>;
    compactNow(): Promise<boolean>;
    destroy(): Promise<void>;
    private open;
    private enqueueWrite;
    private persistRemoteUpdates;
    private enqueueRemotePersistence;
    private flushRemotePersistence;
    private flushRemotePersistenceBuffer;
    private applySiblingLocalUpdate;
    private recordPersistedTail;
    private scheduleOrRequestCompaction;
    private requestCompaction;
    private scheduleIdleCompaction;
    private clearIdleCompactionTimer;
    private mergeReplayEntries;
    private reconcileOutboxFromStore;
    private notifyOutboxState;
    private setState;
}
