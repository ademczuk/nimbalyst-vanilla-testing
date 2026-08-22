// @vitest-environment node
import type {
  FeedbackRequest,
  FeedbackRequestReadModel,
  FeedbackResponse,
} from '@nimbalyst/collab-protocol';
import { describe, expect, it } from 'vitest';

import { asTeamJwt } from '../../auth/jwtScopes';
import { FeedbackRequestSync } from '../FeedbackRequestSync';

class FakeWebSocket {
  static readonly OPEN = 1;

  readonly sent: string[] = [];
  readyState = 0;
  private readonly listeners = new Map<string, Set<(event: any) => void>>();

  addEventListener(type: string, listener: (event: any) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  send(message: string): void {
    this.sent.push(message);
  }

  close(code?: number): void {
    this.readyState = 3;
    this.emit('close', code === undefined ? {} : { code });
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.emit('open', {});
  }

  receive(payload: unknown): void {
    this.emit('message', { data: JSON.stringify(payload) });
  }

  private emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function request(): FeedbackRequest {
  return {
    id: 'request-a',
    urn: 'nimbalyst://feedback-request/request-a',
    orgId: 'org-a',
    author: {
      kind: 'agent',
      sessionId: 'session-a',
      sessionName: 'Review',
      onBehalfOfUserId: 'author-a',
    },
    subjects: [],
    asks: [{
      type: 'confirm',
      id: 'ask-a',
      label: 'Ship it?',
      description: 'Confirm the release.',
    }],
    recipients: [
      { userId: 'recipient-a', name: 'Recipient A' },
      { userId: 'recipient-b', name: 'Recipient B' },
    ],
    assignments: [
      {
        askId: 'ask-a',
        target: { kind: 'user', userId: 'recipient-a' },
      },
      {
        askId: 'ask-a',
        target: { kind: 'user', userId: 'recipient-b' },
      },
    ],
    responses: [],
    discussion: [],
    lifecycle: { status: 'open', changedAt: 1 },
    visibility: 'open',
    wakePolicy: 'quorumOrClose',
    quorum: { requiredRecipientCount: 2 },
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('FeedbackRequestSync', () => {
  it('keeps projected snapshots state-only and correlates concurrent operations by mutation id', async () => {
    const socket = new FakeWebSocket();
    const sync = new FeedbackRequestSync({
      serverUrl: 'https://sync.example.test',
      target: { orgId: 'org-a', requestId: 'request-a' },
      getTeamJwt: async () => asTeamJwt('team-jwt'),
      createWebSocket: (url) => {
        expect(url).toContain(
          '/sync/org:org-a:feedbackRequest:request-a?token=team-jwt',
        );
        return socket as unknown as WebSocket;
      },
    });

    await sync.connect();
    socket.open();
    const initial = sync.sync();
    expect(JSON.parse(socket.sent[0])).toEqual({ type: 'feedbackRequestSync' });
    const firstResponse: FeedbackResponse = {
      id: 'response-a',
      requestId: 'request-a',
      askId: 'ask-a',
      recipientUserId: 'recipient-a',
      answer: { type: 'confirm', value: true },
      createdAt: 2,
      updatedAt: 2,
    };
    const secondResponse: FeedbackResponse = {
      ...firstResponse,
      id: 'response-b',
      recipientUserId: 'recipient-b',
    };
    const fullerRequest: FeedbackRequestReadModel = {
      ...request(),
      responses: [firstResponse, secondResponse],
    };
    socket.receive({
      type: 'feedbackRequestSnapshot',
      request: fullerRequest,
      progress: {
        answeredAskCount: 2,
        totalAssignedAskCount: 2,
        answeredRecipientCount: 2,
        totalRecipientCount: 2,
        quorumReached: true,
      },
    });
    await initial;

    const inbound = {
      type: 'feedbackRequestEvent',
      event: { type: 'feedbackResponse', response: secondResponse },
    };
    socket.receive(inbound);
    socket.receive(inbound);

    expect(sync.getState()?.request.responses).toEqual([
      firstResponse,
      secondResponse,
    ]);

    const restricted = sync.sync();
    expect(JSON.parse(socket.sent[1])).toEqual({ type: 'feedbackRequestSync' });
    const { recipientUserId: _recipientUserId, ...anonymousResponse } = firstResponse;
    socket.receive({
      type: 'feedbackRequestSnapshot',
      request: {
        ...fullerRequest,
        visibility: 'hiddenUntilAnswered',
        responses: [anonymousResponse],
      },
      progress: {
        answeredAskCount: 1,
        totalAssignedAskCount: 2,
        answeredRecipientCount: 1,
        totalRecipientCount: 2,
        quorumReached: false,
      },
    });
    await restricted;

    expect(sync.getState()?.request.responses).toEqual([anonymousResponse]);
    expect(sync.getState()?.progress).toEqual({
      answeredAskCount: 1,
      totalAssignedAskCount: 2,
      answeredRecipientCount: 1,
      totalRecipientCount: 2,
      quorumReached: false,
    });

    let responseSettled = false;
    let nudgeSettled = false;
    const responding = sync.respond(
      'mutation-response',
      'ask-a',
      { type: 'confirm', value: false },
    ).then((state) => {
      responseSettled = true;
      return state;
    });
    const nudging = sync.nudge(
      'mutation-nudge',
      ['recipient-b'],
    ).then((receipt) => {
      nudgeSettled = true;
      return receipt;
    });
    expect(JSON.parse(socket.sent[2])).toMatchObject({
      type: 'feedbackResponse',
      clientMutationId: 'mutation-response',
    });
    expect(JSON.parse(socket.sent[3])).toMatchObject({
      type: 'feedbackRequestNudge',
      clientMutationId: 'mutation-nudge',
    });

    socket.receive({
      type: 'feedbackRequestSnapshot',
      request: {
        ...fullerRequest,
        visibility: 'hiddenUntilAnswered',
        responses: [anonymousResponse],
        updatedAt: 3,
      },
      progress: {
        answeredAskCount: 1,
        totalAssignedAskCount: 2,
        answeredRecipientCount: 1,
        totalRecipientCount: 2,
        quorumReached: false,
      },
    });
    await Promise.resolve();
    expect(responseSettled).toBe(false);
    expect(nudgeSettled).toBe(false);

    socket.receive({
      type: 'feedbackRequestNudgeAck',
      clientMutationId: 'mutation-response',
      requestId: 'request-a',
      recipientUserIds: ['recipient-b'],
      nudgedAt: 4,
      replayed: false,
    });
    await Promise.resolve();
    expect(responseSettled).toBe(false);

    socket.receive({
      type: 'feedbackRequestNudgeAck',
      clientMutationId: 'mutation-nudge',
      requestId: 'request-a',
      recipientUserIds: ['recipient-b'],
      nudgedAt: 5,
      replayed: false,
    });
    await expect(nudging).resolves.toMatchObject({ requestId: 'request-a' });
    expect(nudgeSettled).toBe(true);
    expect(responseSettled).toBe(false);

    socket.receive({
      type: 'feedbackResponseAck',
      clientMutationId: 'timed-out-mutation',
      response: secondResponse,
      progress: {
        answeredAskCount: 2,
        totalAssignedAskCount: 2,
        answeredRecipientCount: 2,
        totalRecipientCount: 2,
        quorumReached: true,
      },
      replayed: false,
    });
    await Promise.resolve();
    expect(responseSettled).toBe(false);

    socket.receive({
      type: 'feedbackResponseAck',
      clientMutationId: 'mutation-response',
      response: firstResponse,
      progress: {
        answeredAskCount: 2,
        totalAssignedAskCount: 2,
        answeredRecipientCount: 2,
        totalRecipientCount: 2,
        quorumReached: true,
      },
      replayed: false,
    });
    await responding;
    expect(responseSettled).toBe(true);
    expect(sync.getState()?.request.responses).toEqual([anonymousResponse]);

    const commenting = sync.comment(
      'mutation-comment',
      {
        version: 1,
        format: 'plainText',
        text: 'The choices need clarification.',
      },
      'comment-parent',
    );
    expect(JSON.parse(socket.sent[4])).toEqual({
      type: 'feedbackRequestComment',
      clientMutationId: 'mutation-comment',
      requestId: 'request-a',
      body: {
        version: 1,
        format: 'plainText',
        text: 'The choices need clarification.',
      },
      replyToCommentId: 'comment-parent',
    });
    socket.receive({
      type: 'feedbackRequestCommentAck',
      clientMutationId: 'mutation-comment',
      requestId: 'request-a',
      comment: {
        id: 'comment-a',
        actor: {
          kind: 'user',
          userId: 'recipient-a',
          onBehalfOfUserId: 'recipient-a',
        },
        body: {
          version: 1,
          format: 'plainText',
          text: 'The choices need clarification.',
        },
        replyToCommentId: 'comment-parent',
        createdAt: 6,
      },
      replayed: false,
    });
    await expect(commenting).resolves.toMatchObject({ id: 'comment-a' });
    sync.destroy();
  });

  it('stops reconnecting when the server closes the socket for revoked access', async () => {
    // A revoked member reconnecting replays the same refused handshake forever;
    // the panel sits on "connecting" with nothing explaining why.
    const sockets: FakeWebSocket[] = [];
    const events: { type: string; code?: string }[] = [];
    const sync = new FeedbackRequestSync({
      serverUrl: 'https://sync.example.test',
      target: { orgId: 'org-a', requestId: 'request-a' },
      getTeamJwt: async () => asTeamJwt('team-jwt'),
      createWebSocket: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
    });
    sync.subscribe((event) => events.push(event));

    await sync.connect();
    sockets[0].open();
    sockets[0].close(4003);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(sockets).toHaveLength(1);
    expect(events).toContainEqual(
      expect.objectContaining({ code: 'FEEDBACK_REQUEST_ACCESS_REVOKED' }),
    );
  });

  it('still reconnects after an ordinary transport close', async () => {
    const sockets: FakeWebSocket[] = [];
    const sync = new FeedbackRequestSync({
      serverUrl: 'https://sync.example.test',
      target: { orgId: 'org-a', requestId: 'request-a' },
      getTeamJwt: async () => asTeamJwt('team-jwt'),
      createWebSocket: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
    });

    await sync.connect();
    sockets[0].open();
    sockets[0].close(1006);

    // Guards the revocation handling above from being over-broad: an ordinary
    // transport close must still retry. Reconnect backoff starts at 1s, so wait
    // past it rather than racing the timer.
    await new Promise((resolve) => setTimeout(resolve, 1_300));

    expect(sockets.length).toBeGreaterThan(1);
    sync.destroy();
  });
});
