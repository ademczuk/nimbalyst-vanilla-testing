import { act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { asTeamJwt, asTeamMemberId } from '@nimbalyst/runtime/auth/jwtScopes';
import { collabCommentControllerRegistry } from '@nimbalyst/runtime/editor/commenting/CollabCommentControllerRegistry';
import { MarkdownCollabContentAdapter } from '@nimbalyst/runtime/sync/MarkdownCollabContentAdapter';
import { mountCollabEditor } from '../mount';
import { CollabPresenceSurface } from '../presence';
import {
  asTeamDocumentId,
  asTeamOrgId,
  asTeamProjectId,
  type CollabEditorCommentsOptions,
  type CollabEditorHandle,
} from '../types';

const mountedHandles: CollabEditorHandle[] = [];

async function settle(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 20; index++) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (let index = 0; index < 20; index++) await Promise.resolve();
  });
}

afterEach(() => {
  for (const handle of mountedHandles.splice(0)) handle.destroy();
  document.body.replaceChildren();
});

describe('in-memory collaborative editor harness', () => {
  it('paints a pre-populated Y.Doc through the provider bridge and accepts input', async () => {
    const yDocument = new Y.Doc();
    MarkdownCollabContentAdapter.seedFromFile(yDocument, '# Bundle harness\n\nPREPOPULATED-MARKER');
    const element = globalThis.document.createElement('div');
    globalThis.document.body.append(element);

    let ready = false;
    const handle = mountCollabEditor({
      element,
      source: { kind: 'in-memory', document: yDocument },
      user: {
        memberId: asTeamMemberId('member-harness'),
        name: 'Harness User',
        cursorColor: '#3366ff',
      },
      onReady: () => { ready = true; },
    });
    mountedHandles.push(handle);

    await settle();
    const editable = element.querySelector<HTMLElement>('[contenteditable="true"]');
    expect(ready).toBe(true);
    expect(editable?.textContent).toContain('PREPOPULATED-MARKER');

    await act(async () => handle.insertText(' ACCEPTED-INPUT'));
    await settle();

    expect(editable?.textContent).toContain('ACCEPTED-INPUT');
    expect(handle.getMarkdown()).toContain('ACCEPTED-INPUT');
    expect(handle.getState()).toMatchObject({
      connection: 'local',
      edit: 'dirty',
      hostReadOnly: false,
      serverAccess: 'not-applicable',
      termination: null,
    });
    await expect(handle.flush()).resolves.toEqual({
      status: 'not-required',
      reason: 'in-memory',
    });
  });

  it('paints tracker and shared-document references written by a desktop client', async () => {
    // A desktop client's node set is wider than the bundle's. A Y.Doc holding
    // either reference node used to abort the whole binding with
    // "Node <type> is not registered", so the document never painted.
    const yDocument = new Y.Doc();
    MarkdownCollabContentAdapter.seedFromFile(
      yDocument,
      'Blocked by [NIM-123](nimbalyst://NIM-123), see [Launch Plan](nimbalyst://doc/fa164469-0e2b-4f1a-9c2d-6b1f0a3d5e77).',
    );
    const element = globalThis.document.createElement('div');
    globalThis.document.body.append(element);

    const errors: string[] = [];
    const handle = mountCollabEditor({
      element,
      source: { kind: 'in-memory', document: yDocument },
      user: {
        memberId: asTeamMemberId('member-references'),
        name: 'Reference User',
      },
      onError: (error) => { errors.push(error.message); },
    });
    mountedHandles.push(handle);
    await settle();

    const editable = element.querySelector<HTMLElement>('[contenteditable="true"]');
    expect(errors).toEqual([]);
    expect(editable?.textContent).toContain('NIM-123');
    expect(editable?.textContent).toContain('Launch Plan');
    expect(handle.getMarkdown()).toContain('[NIM-123](nimbalyst://NIM-123)');
    expect(handle.getMarkdown()).toContain(
      '(nimbalyst://doc/fa164469-0e2b-4f1a-9c2d-6b1f0a3d5e77)',
    );
  });

  it('carries no formatting toolbar and applies the browser-host chrome', async () => {
    const yDocument = new Y.Doc();
    MarkdownCollabContentAdapter.seedFromFile(yDocument, 'Chrome marker');
    const element = globalThis.document.createElement('div');
    globalThis.document.body.append(element);

    const handle = mountCollabEditor({
      element,
      source: { kind: 'in-memory', document: yDocument },
      user: {
        memberId: asTeamMemberId('member-chrome'),
        name: 'Chrome User',
        cursorColor: '#3366ff',
      },
    });
    mountedHandles.push(handle);
    await settle();

    // The desktop document editor has no top toolbar; this host must match it.
    expect(element.querySelector('.toolbar')).toBeNull();
    expect(element.querySelector<HTMLElement>('.editor-scroller')?.classList.contains('select-text'))
      .toBe(true);
    // Remote carets would otherwise read collaborators' names into the prose.
    expect(element.querySelector('.collab-cursors-container')?.getAttribute('aria-hidden'))
      .toBe('true');
  });

  it('announces lifecycle departure and rejoins when the document becomes active', async () => {
    const setActive = vi.spyOn(CollabPresenceSurface.prototype, 'setActive');
    const visibilityState = vi.spyOn(document, 'visibilityState', 'get');
    const element = document.createElement('div');
    document.body.append(element);
    const handle = mountCollabEditor({
      element,
      source: { kind: 'in-memory', document: new Y.Doc() },
      user: {
        memberId: asTeamMemberId('member-lifecycle'),
        name: 'Lifecycle User',
      },
    });
    mountedHandles.push(handle);
    await settle();

    window.dispatchEvent(new Event('pagehide'));
    expect(setActive).toHaveBeenLastCalledWith(false);

    window.dispatchEvent(new Event('pageshow'));
    expect(setActive).toHaveBeenLastCalledWith(true);

    visibilityState.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(setActive).toHaveBeenLastCalledWith(false);

    visibilityState.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(setActive).toHaveBeenLastCalledWith(true);

    handle.setPresenceActive(false);
    expect(setActive).toHaveBeenLastCalledWith(false);
    handle.setPresenceActive(true);
    expect(setActive).toHaveBeenLastCalledWith(true);
    visibilityState.mockRestore();
    setActive.mockRestore();
  });
});

/**
 * A room socket that opens and answers the initial sync, and nothing else.
 *
 * That is precisely the state a reader is in: the document arrived, no edit has
 * been attempted, so the server has never acknowledged or refused a write.
 */
class FakeRoomSocket {
  static readonly opened: FakeRoomSocket[] = [];
  readyState = 0;
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  constructor() {
    FakeRoomSocket.opened.push(this);
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const current = this.listeners.get(type) ?? new Set<(event: unknown) => void>();
    current.add(listener);
    this.listeners.set(type, current);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  send(): void {}

  close(): void {
    this.readyState = 3;
  }

  open(): void {
    this.readyState = 1;
    this.emit('open', {});
  }

  /** The server's answer to `docSyncRequest`: a document, and no write verdict. */
  deliverSyncResponse(): void {
    this.emit('message', {
      data: JSON.stringify({
        type: 'docSyncResponse',
        updates: [],
        hasMore: false,
        cursor: 0,
        serverHead: 0,
        serverHasState: true,
      }),
    });
  }

  deliverWriteAcknowledged(): void {
    this.emit('message', {
      data: JSON.stringify({ type: 'docUpdateAck', clientUpdateId: 'probe-access' }),
    });
  }

  private emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

describe('comment authoring on a document that has not been written to', () => {
  async function openTeamDocument(
    documentId: string,
    canComment: () => boolean,
  ): Promise<{ handle: CollabEditorHandle; documentUri: string }> {
    FakeRoomSocket.opened.length = 0;
    const element = document.createElement('div');
    document.body.append(element);
    const documentUri = `nimbalyst://doc/${documentId}`;
    const comments: CollabEditorCommentsOptions = {
      currentUser: { id: 'member-reader', name: 'Reader' },
      getMembers: () => [],
      documentTitle: 'Shared plan',
      documentId,
      documentUri,
      canComment,
    };
    const handle = mountCollabEditor({
      element,
      source: {
        kind: 'team-room',
        serverUrl: 'ws://collab.test',
        room: {
          orgId: asTeamOrgId('org-comments'),
          projectId: asTeamProjectId('project-comments'),
          documentId: asTeamDocumentId(documentId),
        },
        auth: {
          scope: 'team',
          memberId: asTeamMemberId('member-reader'),
          getTeamJwt: async () => asTeamJwt('team-jwt'),
        },
        createWebSocket: () => new FakeRoomSocket() as unknown as WebSocket,
      },
      user: { memberId: asTeamMemberId('member-reader'), name: 'Reader' },
      comments,
    });
    mountedHandles.push(handle);
    await settle();

    const socket = FakeRoomSocket.opened[0];
    if (!socket) throw new Error('the editor never opened a room socket');
    await act(async () => {
      socket.open();
      socket.deliverSyncResponse();
    });
    await settle();
    return { handle, documentUri };
  }

  function commentCapability(documentUri: string): boolean {
    const controller = collabCommentControllerRegistry.get(documentUri);
    if (!controller) throw new Error('the comment plugin never registered a controller');
    return controller.getCapabilities().comment;
  }

  function commentController(documentUri: string) {
    const controller = collabCommentControllerRegistry.get(documentUri);
    if (!controller) throw new Error('the comment plugin never registered a controller');
    return controller;
  }

  it('withholds authoring until server access is known, then follows host permission', async () => {
    const writer = await openTeamDocument('doc-writer', () => true);
    expect(writer.handle.getState()).toMatchObject({
      connection: 'connected',
      serverAccess: 'unknown',
    });
    expect(commentCapability(writer.documentUri)).toBe(false);
    await expect(commentController(writer.documentUri).createAnchored({
      anchor: { exact: 'not present' },
      body: 'Must not be written locally',
      clientMutationId: 'unknown-access-attempt',
    }, {
      kind: 'user',
      userId: 'member-reader',
      displayName: 'Reader',
    })).rejects.toMatchObject({ code: 'COMMENT_FORBIDDEN' });
    expect(writer.handle.getDocument().getArray('comments')).toHaveLength(0);

    const writerSocket = FakeRoomSocket.opened[0];
    if (!writerSocket) throw new Error('the writer never opened a room socket');
    await act(async () => writerSocket.deliverWriteAcknowledged());
    expect(commentCapability(writer.documentUri)).toBe(true);

    const viewer = await openTeamDocument('doc-viewer', () => false);
    expect(viewer.handle.getState()).toMatchObject({
      connection: 'connected',
      serverAccess: 'unknown',
    });
    expect(commentCapability(viewer.documentUri)).toBe(false);
  });
});
