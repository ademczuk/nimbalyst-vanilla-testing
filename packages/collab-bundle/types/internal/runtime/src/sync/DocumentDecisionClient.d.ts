import type { DocDecisionStateMessage, DocumentDecisionCommand, DocumentDecisionDeliveryState, DocumentDecisionAuthority, DocumentDecisionResult, DocClientMessage } from "@nimbalyst/collab-protocol";
/** Correlated, viewer-scoped projections; mutation acknowledgements are never replayed. */
export declare class DocumentDecisionClient {
    private readonly send;
    private readonly ready;
    private readonly flush;
    private listing;
    private retryWait;
    private refreshTimer;
    private refreshing;
    private mutations;
    private refreshAgain;
    private epoch;
    private connection;
    private sequence;
    private applied;
    private state;
    private authority;
    private listeners;
    private pending;
    constructor(send: (message: DocClientMessage) => void, ready: () => boolean, flush: () => Promise<boolean>);
    getState: () => DocumentDecisionDeliveryState[];
    subscribe: (listener: (state: DocumentDecisionDeliveryState[], authority: DocumentDecisionAuthority) => void) => (() => void);
    private publish;
    private clear;
    hasPendingMutations: () => boolean;
    request(command: DocumentDecisionCommand): Promise<DocumentDecisionResult>;
    private requestFreshList;
    private requestCommand;
    receive(message: DocDecisionStateMessage): void;
    refreshSubscribers(): void;
    /** Clear synchronously; fetch only each connection's authorized projection. */
    invalidate(): void;
    private scheduleRefresh;
    disconnect(): void;
}
