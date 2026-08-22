import { type FeedbackAnswer, type FeedbackDiscussionComment, type FeedbackRequestCreateInput, type FeedbackRequestLifecycleStatus, type FeedbackRequestProgress, type FeedbackRequestReadModel, type RichCommentBody } from '@nimbalyst/collab-protocol';
import type { TeamJwt } from '../auth/jwtScopes';
export interface FeedbackRequestTarget {
    orgId: string;
    requestId: string;
}
export interface FeedbackRequestSyncState {
    request: FeedbackRequestReadModel;
    progress: FeedbackRequestProgress;
}
export interface FeedbackRequestNudgeReceipt {
    requestId: string;
    recipientUserIds: string[];
    nudgedAt: number;
}
export type FeedbackRequestSyncEvent = {
    type: 'connecting';
} | {
    type: 'connected';
} | {
    type: 'state';
    state: FeedbackRequestSyncState;
} | {
    type: 'nudged';
    receipt: FeedbackRequestNudgeReceipt;
} | {
    type: 'disconnected';
} | {
    type: 'error';
    code: string;
    message: string;
};
export interface FeedbackRequestSyncConfig {
    serverUrl: string;
    target: FeedbackRequestTarget;
    getTeamJwt: () => Promise<TeamJwt>;
    createWebSocket?: (url: string) => WebSocket;
}
export declare class FeedbackRequestSyncError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
/** Team-JWT WebSocket transport for one FeedbackRequestRoom. */
export declare class FeedbackRequestSync {
    readonly target: FeedbackRequestTarget;
    private readonly config;
    private readonly listeners;
    private readonly pendingRequests;
    private readonly snapshotWaiters;
    private ws;
    private state;
    private snapshotVersion;
    private syncRequested;
    private destroyed;
    /** Server said this member may not be here. Terminal for reconnects only. */
    private accessRevoked;
    private reconnectAttempt;
    private reconnectTimer;
    constructor(config: FeedbackRequestSyncConfig);
    connect(): Promise<void>;
    subscribe(listener: (event: FeedbackRequestSyncEvent) => void): () => void;
    getState(): FeedbackRequestSyncState | null;
    sync(): Promise<FeedbackRequestSyncState>;
    create(clientMutationId: string, request: FeedbackRequestCreateInput): Promise<FeedbackRequestSyncState>;
    respond(clientMutationId: string, askId: string, answer: FeedbackAnswer): Promise<FeedbackRequestSyncState>;
    comment(clientMutationId: string, body: RichCommentBody, replyToCommentId?: string): Promise<FeedbackDiscussionComment>;
    close(clientMutationId: string, status: Exclude<FeedbackRequestLifecycleStatus, 'open'>): Promise<FeedbackRequestSyncState>;
    nudge(clientMutationId: string, recipientUserIds?: string[]): Promise<FeedbackRequestNudgeReceipt>;
    destroy(): void;
    private requestMutation;
    private waitForSnapshot;
    private flushRequests;
    private handleMessage;
    private applyEvent;
    private unexpectedResponse;
    private setState;
    private applySnapshot;
    private finishMutation;
    private ackMatchesTarget;
    private rejectRequests;
    private emit;
    private scheduleReconnect;
}
