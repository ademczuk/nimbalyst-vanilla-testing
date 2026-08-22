import {
  feedbackRequestRoomId,
  getFeedbackRequestProgress,
  type FeedbackAnswer,
  type FeedbackDiscussionComment,
  type FeedbackRequestClientMessage,
  type FeedbackRequestCreateInput,
  type FeedbackRequestLifecycleStatus,
  type FeedbackRequestProgress,
  type FeedbackRequestReadModel,
  type FeedbackRequestServerMessage,
  type RichCommentBody,
} from '@nimbalyst/collab-protocol';

import type { TeamJwt } from '../auth/jwtScopes';
import {
  collabAccessRevokedMessage,
  isCollabAccessRevokedCloseCode,
} from './collabCloseCodes';
import { appendSyncClientParams } from './syncClientInfo';

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const REQUEST_TIMEOUT_MS = 10_000;

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

export type FeedbackRequestSyncEvent =
  | { type: 'connecting' }
  | { type: 'connected' }
  | { type: 'state'; state: FeedbackRequestSyncState }
  | { type: 'nudged'; receipt: FeedbackRequestNudgeReceipt }
  | { type: 'disconnected' }
  | { type: 'error'; code: string; message: string };

export interface FeedbackRequestSyncConfig {
  serverUrl: string;
  target: FeedbackRequestTarget;
  getTeamJwt: () => Promise<TeamJwt>;
  createWebSocket?: (url: string) => WebSocket;
}

type FeedbackMutationAckMessage = Extract<
  FeedbackRequestServerMessage,
  { clientMutationId: string }
>;

interface PendingRequest {
  message: Exclude<FeedbackRequestClientMessage, { type: 'feedbackRequestSync' }>;
  expectedType: FeedbackMutationAckMessage['type'];
  resolve: (message: FeedbackMutationAckMessage) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  sent: boolean;
}

interface SnapshotWaiter {
  minimumVersion: number;
  resolve: (state: FeedbackRequestSyncState) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

function toWebSocketBase(serverUrl: string): string {
  return serverUrl
    .replace(/^https:/, 'wss:')
    .replace(/^http:/, 'ws:')
    .replace(/\/+$/, '');
}

function initialProgressForReadModel(
  request: FeedbackRequestReadModel,
): FeedbackRequestProgress {
  return getFeedbackRequestProgress({
    ...request,
    responses: [],
  });
}

export class FeedbackRequestSyncError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'FeedbackRequestSyncError';
    this.code = code;
  }
}

/** Team-JWT WebSocket transport for one FeedbackRequestRoom. */
export class FeedbackRequestSync {
  readonly target: FeedbackRequestTarget;

  private readonly config: FeedbackRequestSyncConfig;
  private readonly listeners = new Set<(event: FeedbackRequestSyncEvent) => void>();
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly snapshotWaiters = new Set<SnapshotWaiter>();
  private ws: WebSocket | null = null;
  private state: FeedbackRequestSyncState | null = null;
  private snapshotVersion = 0;
  private syncRequested = false;
  private destroyed = false;
  /** Server said this member may not be here. Terminal for reconnects only. */
  private accessRevoked = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: FeedbackRequestSyncConfig) {
    this.config = config;
    this.target = config.target;
  }

  async connect(): Promise<void> {
    if (this.destroyed) throw new Error('Feedback request sync has been destroyed');
    if (this.ws) return;
    // An explicit reconnect is the caller asserting access may have been
    // restored; let the server be the judge again.
    this.accessRevoked = false;

    this.emit({ type: 'connecting' });
    try {
      const jwt = await this.config.getTeamJwt();
      if (this.destroyed || this.ws) return;
      const roomId = feedbackRequestRoomId(
        this.target.orgId,
        this.target.requestId,
      );
      const url = appendSyncClientParams(
        `${toWebSocketBase(this.config.serverUrl)}/sync/${roomId}`
          + `?token=${encodeURIComponent(jwt)}`,
      );
      const ws = this.config.createWebSocket
        ? this.config.createWebSocket(url)
        : new WebSocket(url);
      this.ws = ws;

      ws.addEventListener('open', () => {
        if (this.ws !== ws) return;
        this.reconnectAttempt = 0;
        this.emit({ type: 'connected' });
        this.flushRequests();
      });
      ws.addEventListener('message', (event) => {
        if (this.ws !== ws) return;
        this.handleMessage(event.data);
      });
      ws.addEventListener('close', (event) => {
        if (this.ws !== ws) return;
        this.ws = null;
        const code = (event as CloseEvent | undefined)?.code;
        const revoked = isCollabAccessRevokedCloseCode(code);
        this.rejectRequests(new FeedbackRequestSyncError(
          revoked
            ? 'FEEDBACK_REQUEST_ACCESS_REVOKED'
            : 'FEEDBACK_REQUEST_CONNECTION_CLOSED',
          revoked
            ? collabAccessRevokedMessage(code)
            : 'Feedback request connection closed before the request completed',
        ));
        this.emit({ type: 'disconnected' });
        if (revoked) {
          // Settled answer, not a blip -- reconnecting replays the same refused
          // handshake forever and leaves the panel silently stuck connecting.
          // Kept separate from `destroyed` so this stays a statement about
          // access, not about teardown: a caller that re-connects after the
          // member is re-added gets a connection attempt, not "destroyed".
          this.accessRevoked = true;
          this.emit({
            type: 'error',
            code: 'FEEDBACK_REQUEST_ACCESS_REVOKED',
            message: collabAccessRevokedMessage(code),
          });
          return;
        }
        this.scheduleReconnect();
      });
      ws.addEventListener('error', () => {
        if (this.ws === ws) ws.close();
      });
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      this.emit({
        type: 'error',
        code: 'FEEDBACK_REQUEST_CONNECTION_FAILED',
        message: normalized.message,
      });
      this.rejectRequests(normalized);
      this.scheduleReconnect();
      throw normalized;
    }
  }

  subscribe(listener: (event: FeedbackRequestSyncEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  getState(): FeedbackRequestSyncState | null {
    return this.state;
  }

  async sync(): Promise<FeedbackRequestSyncState> {
    if (this.destroyed) {
      throw new Error('Feedback request sync has been destroyed');
    }
    const result = this.waitForSnapshot(this.snapshotVersion + 1);
    this.syncRequested = true;
    this.flushRequests();
    return result;
  }

  async create(
    clientMutationId: string,
    request: FeedbackRequestCreateInput,
  ): Promise<FeedbackRequestSyncState> {
    const response = await this.requestMutation({
      type: 'feedbackRequestCreate',
      clientMutationId,
      request,
    }, 'feedbackRequestCreateAck');
    if (response.type !== 'feedbackRequestCreateAck') {
      throw this.unexpectedResponse('feedbackRequestCreateAck', response.type);
    }
    return this.setState(
      response.request,
      this.state?.progress ?? initialProgressForReadModel(response.request),
    );
  }

  async respond(
    clientMutationId: string,
    askId: string,
    answer: FeedbackAnswer,
  ): Promise<FeedbackRequestSyncState> {
    const response = await this.requestMutation({
      type: 'feedbackResponse',
      clientMutationId,
      requestId: this.target.requestId,
      askId,
      answer,
    }, 'feedbackResponseAck');
    if (response.type !== 'feedbackResponseAck') {
      throw this.unexpectedResponse('feedbackResponseAck', response.type);
    }
    if (!this.state) {
      throw new FeedbackRequestSyncError(
        'FEEDBACK_REQUEST_STATE_MISSING',
        'Feedback request must be synchronized before responding',
      );
    }
    // The ack proves the write succeeded, but its raw response is never folded
    // into readable state. The server's following snapshot is the visibility
    // boundary and replaces the response set wholesale.
    return this.state;
  }

  async comment(
    clientMutationId: string,
    body: RichCommentBody,
    replyToCommentId?: string,
  ): Promise<FeedbackDiscussionComment> {
    const response = await this.requestMutation({
      type: 'feedbackRequestComment',
      clientMutationId,
      requestId: this.target.requestId,
      body,
      replyToCommentId,
    }, 'feedbackRequestCommentAck');
    if (response.type !== 'feedbackRequestCommentAck') {
      throw this.unexpectedResponse('feedbackRequestCommentAck', response.type);
    }
    return response.comment;
  }

  async close(
    clientMutationId: string,
    status: Exclude<FeedbackRequestLifecycleStatus, 'open'>,
  ): Promise<FeedbackRequestSyncState> {
    const response = await this.requestMutation({
      type: 'feedbackRequestClose',
      clientMutationId,
      requestId: this.target.requestId,
      status,
    }, 'feedbackRequestCloseAck');
    if (response.type !== 'feedbackRequestCloseAck') {
      throw this.unexpectedResponse('feedbackRequestCloseAck', response.type);
    }
    return this.setState(
      response.request,
      this.state?.progress ?? initialProgressForReadModel(response.request),
    );
  }

  async nudge(
    clientMutationId: string,
    recipientUserIds?: string[],
  ): Promise<FeedbackRequestNudgeReceipt> {
    const response = await this.requestMutation({
      type: 'feedbackRequestNudge',
      clientMutationId,
      requestId: this.target.requestId,
      recipientUserIds,
    }, 'feedbackRequestNudgeAck');
    if (response.type !== 'feedbackRequestNudgeAck') {
      throw this.unexpectedResponse('feedbackRequestNudgeAck', response.type);
    }
    const receipt = {
      requestId: response.requestId,
      recipientUserIds: response.recipientUserIds,
      nudgedAt: response.nudgedAt,
    };
    this.emit({ type: 'nudged', receipt });
    return receipt;
  }

  destroy(): void {
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.rejectRequests(new FeedbackRequestSyncError(
      'FEEDBACK_REQUEST_DESTROYED',
      'Feedback request sync was destroyed',
    ));
    this.listeners.clear();
  }

  private requestMutation(
    message: Exclude<FeedbackRequestClientMessage, { type: 'feedbackRequestSync' }>,
    expectedType: FeedbackMutationAckMessage['type'],
  ): Promise<FeedbackMutationAckMessage> {
    if (this.destroyed) {
      return Promise.reject(new Error('Feedback request sync has been destroyed'));
    }
    if (this.pendingRequests.has(message.clientMutationId)) {
      return Promise.reject(new FeedbackRequestSyncError(
        'FEEDBACK_REQUEST_DUPLICATE_MUTATION',
        `Feedback request mutation ${message.clientMutationId} is already pending`,
      ));
    }
    const result = new Promise<FeedbackMutationAckMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(message.clientMutationId);
        reject(new FeedbackRequestSyncError(
          'FEEDBACK_REQUEST_TIMEOUT',
          `Feedback request mutation ${message.clientMutationId} timed out`,
        ));
      }, REQUEST_TIMEOUT_MS);
      this.pendingRequests.set(message.clientMutationId, {
        message,
        expectedType,
        resolve,
        reject,
        timer,
        sent: false,
      });
    });
    this.flushRequests();
    return result;
  }

  private waitForSnapshot(minimumVersion: number): Promise<FeedbackRequestSyncState> {
    return new Promise((resolve, reject) => {
      const waiter: SnapshotWaiter = {
        minimumVersion,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.snapshotWaiters.delete(waiter);
          reject(new FeedbackRequestSyncError(
            'FEEDBACK_REQUEST_TIMEOUT',
            'Feedback request snapshot timed out',
          ));
        }, REQUEST_TIMEOUT_MS),
      };
      this.snapshotWaiters.add(waiter);
    });
  }

  private flushRequests(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.syncRequested) {
      this.syncRequested = false;
      this.ws.send(JSON.stringify({ type: 'feedbackRequestSync' }));
    }
    for (const pending of this.pendingRequests.values()) {
      if (pending.sent) continue;
      pending.sent = true;
      this.ws.send(JSON.stringify(pending.message));
    }
  }

  private handleMessage(raw: unknown): void {
    try {
      const message = JSON.parse(
        typeof raw === 'string' ? raw : String(raw),
      ) as FeedbackRequestServerMessage;
      if (message.type === 'feedbackRequestEvent') {
        this.applyEvent(message.event);
        return;
      }
      if (message.type === 'feedbackRequestError') {
        const error = new FeedbackRequestSyncError(
          String(message.code ?? 'FEEDBACK_REQUEST_ERROR'),
          String(message.message ?? 'Feedback request failed'),
        );
        this.emit({ type: 'error', code: error.code, message: error.message });
        // Errors do not carry a mutation id, so they cannot safely reject one
        // caller. Fail every waiter rather than mis-correlating the error.
        this.rejectRequests(error);
        return;
      }

      if (message.type === 'feedbackRequestSnapshot') {
        if (
          message.request.id !== this.target.requestId
          || message.request.orgId !== this.target.orgId
        ) return;
        this.applySnapshot(message.request, message.progress);
        return;
      }

      this.finishMutation(message);
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      this.emit({
        type: 'error',
        code: 'FEEDBACK_REQUEST_PROTOCOL_ERROR',
        message: normalized.message,
      });
      this.rejectRequests(normalized);
    }
  }

  private applyEvent(event: Extract<FeedbackRequestServerMessage, {
    type: 'feedbackRequestEvent';
  }>['event']): void {
    if (event.type === 'feedbackRequestNudged') {
      this.emit({
        type: 'nudged',
        receipt: {
          requestId: event.requestId,
          recipientUserIds: event.recipientUserIds,
          nudgedAt: event.nudgedAt,
        },
      });
    }
    // Created, response, and close events may contain unprojected resource
    // data. Only server-projected snapshots are allowed to update read state.
  }

  private unexpectedResponse(
    expectedType: FeedbackMutationAckMessage['type'],
    actualType: FeedbackMutationAckMessage['type'],
  ): FeedbackRequestSyncError {
    return new FeedbackRequestSyncError(
      'FEEDBACK_REQUEST_UNEXPECTED_RESPONSE',
      `Expected ${expectedType} but received ${actualType}`,
    );
  }

  private setState(
    request: FeedbackRequestReadModel,
    progress: FeedbackRequestProgress,
  ): FeedbackRequestSyncState {
    this.state = { request, progress };
    this.emit({ type: 'state', state: this.state });
    return this.state;
  }

  private applySnapshot(
    request: FeedbackRequestReadModel,
    progress: FeedbackRequestProgress,
  ): FeedbackRequestSyncState {
    const state = this.setState(request, progress);
    this.snapshotVersion += 1;
    for (const waiter of [...this.snapshotWaiters]) {
      if (waiter.minimumVersion > this.snapshotVersion) continue;
      this.snapshotWaiters.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.resolve(state);
    }
    return state;
  }

  private finishMutation(message: FeedbackMutationAckMessage): void {
    const pending = this.pendingRequests.get(message.clientMutationId);
    if (!pending || message.type !== pending.expectedType) return;
    if (!this.ackMatchesTarget(message)) return;
    this.pendingRequests.delete(message.clientMutationId);
    clearTimeout(pending.timer);
    pending.resolve(message);
  }

  private ackMatchesTarget(message: FeedbackMutationAckMessage): boolean {
    if (
      message.type === 'feedbackRequestCreateAck'
      || message.type === 'feedbackRequestCloseAck'
    ) {
      return (
        message.request.id === this.target.requestId
        && message.request.orgId === this.target.orgId
      );
    }
    if (message.type === 'feedbackResponseAck') {
      return message.response.requestId === this.target.requestId;
    }
    return message.requestId === this.target.requestId;
  }

  private rejectRequests(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingRequests.clear();
    for (const waiter of this.snapshotWaiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.snapshotWaiters.clear();
    this.syncRequested = false;
  }

  private emit(event: FeedbackRequestSyncEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.accessRevoked || this.reconnectTimer) return;
    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** this.reconnectAttempt,
      RECONNECT_MAX_MS,
    );
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch(() => undefined);
    }, delay);
  }
}
