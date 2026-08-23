// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import {
  deriveCollabEditorCommentsState,
  resolveDocumentCommentCapabilities,
} from '../commenting';

describe('collab editor comments state', () => {
  it('combines the host role answer with server access, and hydrates on first connection', () => {
    // A roster-derived role is not authoritative for this document. Until the
    // server has acknowledged access, authoring must fail closed.
    const beforeAnyWrite = deriveCollabEditorCommentsState({
      connection: 'syncing',
      serverAccess: 'unknown',
      hasConnectedOnce: false,
      hostCanComment: true,
    });
    expect(beforeAnyWrite).toEqual({
      hasConnectedOnce: false,
      isHydrated: false,
      capabilities: { read: true, comment: false },
    });

    // The host's answer is authoritative in the other direction: a viewer is
    // refused on a connection the server has said nothing about.
    for (const serverAccess of ['unknown', 'writable', 'not-applicable'] as const) {
      expect(deriveCollabEditorCommentsState({
        connection: 'connected',
        serverAccess,
        hasConnectedOnce: true,
        hostCanComment: false,
      }).capabilities).toEqual({ read: true, comment: false });
    }

    // Every unavailable or negative server answer overrides a host that says yes.
    for (const serverAccess of ['unknown', 'read-only', 'revoked', 'not-applicable'] as const) {
      expect(deriveCollabEditorCommentsState({
        connection: 'connected',
        serverAccess,
        hasConnectedOnce: true,
        hostCanComment: true,
      }).capabilities).toEqual({ read: true, comment: false });
    }

    const connected = deriveCollabEditorCommentsState({
      connection: 'connected',
      serverAccess: 'writable',
      hasConnectedOnce: false,
      hostCanComment: true,
    });
    expect(connected).toEqual({
      hasConnectedOnce: true,
      isHydrated: true,
      capabilities: { read: true, comment: true },
    });
    expect(deriveCollabEditorCommentsState({
      connection: 'disconnected',
      serverAccess: 'unknown',
      hasConnectedOnce: connected.hasConnectedOnce,
      hostCanComment: true,
    }).isHydrated).toBe(true);
  });
});

describe('document comment access', () => {
  it('grants comment capability without requiring edit access', async () => {
    const canAccess = vi.fn(async (input: { action: 'view' | 'edit' | 'admin' }) => ({
      allowed: input.action === 'view',
    }));

    await expect(resolveDocumentCommentCapabilities(canAccess, {
      orgId: 'org-1',
      projectId: 'project-1',
    })).resolves.toEqual({ read: true, comment: true });
    expect(canAccess).toHaveBeenCalledTimes(1);
    expect(canAccess).toHaveBeenCalledWith({
      orgId: 'org-1',
      projectId: 'project-1',
      action: 'view',
    });
  });
});
