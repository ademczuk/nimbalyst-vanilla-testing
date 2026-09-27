import type { LocalReplicaIdentity, LocalReplicaStore } from "./LocalReplicaStore";
export interface OutboxDrainBatch {
    identity: LocalReplicaIdentity;
    documentType: string;
    batchId: string;
    batchIds: string[];
    update: Uint8Array;
}
export type OutboxDrainSendResult = {
    status: "acknowledged";
    sequence: number;
} | {
    status: "rejected";
    errorCode: string;
};
export interface OutboxDrainTransport {
    send(batch: OutboxDrainBatch): Promise<OutboxDrainSendResult>;
    close?(): void | Promise<void>;
}
export interface OutboxDrainerOptions {
    store: LocalReplicaStore;
    createTransport: (identity: LocalReplicaIdentity) => Promise<OutboxDrainTransport>;
    isLiveProviderAttached?: (identity: LocalReplicaIdentity) => boolean;
    /** Injectable for tests. */
    now?: () => number;
}
export interface OutboxDrainResult {
    documentsExamined: number;
    batchesUploaded: number;
    rejectedBatches: number;
    /** Documents skipped this pass because their retry backoff had not elapsed. */
    documentsDeferred: number;
    /** Documents that have failed repeatedly and are not converging. */
    stuck: StuckOutboxDocument[];
}
export interface StuckOutboxDocument {
    identity: LocalReplicaIdentity;
    batchCount: number;
    attemptCount: number;
    lastErrorCode: string | null;
    oldestCreatedAt: number | null;
}
/**
 * Retry backoff for a document whose upload keeps failing.
 *
 * The periodic trigger fires every 30s. Without backoff a permanently-failing
 * document is re-uploaded 2,880 times a day — one full WebSocket connect,
 * merge and send per pass — and every one of those passes queues on the same
 * single-lane DB worker as the rest of the app. A document stranded since
 * 2026-08-05 against an HTTP 404 room did exactly that.
 */
export declare const OUTBOX_RETRY_BASE_MS = 30000;
export declare const OUTBOX_RETRY_MAX_MS: number;
/** Failures before a document is reported as not converging. */
export declare const OUTBOX_STUCK_ATTEMPTS = 5;
export declare function outboxRetryDelayMs(attemptCount: number): number;
export declare class OutboxWriteRejectedError extends Error {
    readonly errorCode: string;
    constructor(errorCode: string, message?: string);
}
/** Unknown and write-barrier codes are retryable by design. */
export declare function isConfirmedOutboxRevocationCode(errorCode: string): boolean;
/**
 * Transport-only durable outbox replay. It never constructs a Y.Doc, applies
 * remote state, or advances a replica cursor. Y.mergeUpdates only combines
 * update bytes and does not materialize document state.
 */
export declare class OutboxDrainer {
    private readonly store;
    private readonly createTransport;
    private readonly isLiveProviderAttached;
    private activeRun;
    private readonly yieldedIdentities;
    private readonly activeTransports;
    private readonly documentRuns;
    private readonly now;
    constructor(options: OutboxDrainerOptions);
    /**
     * `respectBackoff` is for the unconditional periodic cadence only. An
     * event-driven trigger — network restored, auth restored, a live provider
     * detaching — is new information that the previous failure may no longer
     * apply, so it always retries immediately.
     */
    drainOnce(accountId?: string, options?: {
        respectBackoff?: boolean;
    }): Promise<OutboxDrainResult>;
    /** Stops and settles a document drain before a live provider may attach. */
    yieldToLiveProvider(identity: LocalReplicaIdentity): Promise<void>;
    resumeAfterLiveProvider(identity: LocalReplicaIdentity): void;
    private shouldYield;
    private run;
    private drainDocument;
}
