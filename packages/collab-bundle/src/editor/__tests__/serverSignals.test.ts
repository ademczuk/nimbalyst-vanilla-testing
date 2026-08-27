import { describe, expect, it } from 'vitest';

import {
  classifyDocumentClose,
  parseDocumentServerSignal,
} from '../serverSignals';

describe('document room server signals', () => {
  it('preserves the originating clientUpdateId on a read-only rejection', () => {
    expect(parseDocumentServerSignal(JSON.stringify({
      type: 'error',
      code: 'document_read_only',
      message: 'Role permits reading only',
      clientUpdateId: 'client-update-17',
    }))).toEqual({
      type: 'read-only',
      message: 'Role permits reading only',
      clientUpdateId: 'client-update-17',
    });
  });

  it('distinguishes proactive read-only from write-correlated rejection', () => {
    expect(parseDocumentServerSignal(JSON.stringify({
      type: 'error',
      code: 'document_read_only',
      message: 'Project access changed',
    }))).toEqual({
      type: 'read-only',
      message: 'Project access changed',
    });
  });

  it('reads the write verdict the sync response carries', () => {
    // The server resolves access on every docSyncRequest, so this is the one
    // authoritative answer that arrives without the client writing first.
    expect(parseDocumentServerSignal(JSON.stringify({
      type: 'docSyncResponse',
      updates: [],
      hasMore: false,
      cursor: 0,
      canWrite: true,
    }))).toEqual({ type: 'access-verdict', canWrite: true });

    expect(parseDocumentServerSignal(JSON.stringify({
      type: 'docSyncResponse',
      updates: [],
      hasMore: false,
      cursor: 0,
      canWrite: false,
    }))).toEqual({ type: 'access-verdict', canWrite: false });
  });

  it('ignores a sync response from a server that predates the write verdict', () => {
    // Older servers omit the field entirely. Reporting a verdict here would
    // invent one, so the client is left to fall back to its host answer.
    expect(parseDocumentServerSignal(JSON.stringify({
      type: 'docSyncResponse',
      updates: [],
      hasMore: false,
      cursor: 0,
    }))).toBeNull();
  });

  it('distinguishes terminal authorization closes from ordinary disconnects', () => {
    expect(classifyDocumentClose(4002, 'Removed from team')).toEqual({
      reason: 'removed-from-org',
      closeCode: 4002,
      message: 'Removed from team',
    });
    expect(classifyDocumentClose(4003, 'Document access revoked')).toEqual({
      reason: 'document-access-revoked',
      closeCode: 4003,
      message: 'Document access revoked',
    });
    // A deleted room is terminal too: without this the host reconnects into a
    // room that no longer exists and reports it as a failed sync.
    expect(classifyDocumentClose(4004, '')).toEqual({
      reason: 'deleted-document',
      closeCode: 4004,
      message: 'Document was deleted',
    });
    expect(classifyDocumentClose(1006, '')).toBeNull();
  });
});
