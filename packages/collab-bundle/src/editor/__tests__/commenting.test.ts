// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { deriveCollabEditorCommentsState } from '../commenting';

describe('collab editor comments state', () => {
  it('combines the host role answer with server access, and hydrates on first connection', () => {
    // The regression this replaces: `unknown` was treated as "no comments".
    // `writable` is only ever reached from a write acknowledgement, so a writer
    // who had not typed yet never left `unknown` and never got the affordance.
    const beforeAnyWrite = deriveCollabEditorCommentsState({
      connection: 'syncing',
      serverAccess: 'unknown',
      hasConnectedOnce: false,
      hostCanComment: true,
    });
    expect(beforeAnyWrite).toEqual({
      hasConnectedOnce: false,
      isHydrated: false,
      capabilities: { read: true, comment: true },
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

    // And a server restriction overrides a host that says yes.
    for (const serverAccess of ['read-only', 'revoked'] as const) {
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
