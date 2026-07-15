import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../logger', () => ({
  logger: { ui: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } },
}));
import { buildCollabUri } from '../collabUri';
import {
  registerCollabConfig,
  removeCollabConfig,
  resolveCollabConfigForUri,
} from '../collabDocumentOpener';

const workspacePath = '/workspace';
const documentId = 'doc-rotation';
const uri = buildCollabUri('org-a', documentId);

afterEach(() => {
  removeCollabConfig(uri);
  vi.unstubAllGlobals();
});

describe('collab document key rotation resolution', () => {
  it('bypasses cached aliases and decrypts with the freshly fetched key', async () => {
    const oldKeyBytes = new Uint8Array(32).fill(1);
    const newKeyBytes = new Uint8Array(32).fill(2);
    const oldDocumentKey = await crypto.subtle.importKey(
      'raw', oldKeyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'],
    );
    registerCollabConfig({
      workspacePath,
      orgId: 'org-a',
      documentId,
      title: 'Rotating doc',
      documentType: 'markdown',
      keyCustody: 'legacy-e2e',
      documentKey: oldDocumentKey,
      orgKeyFingerprint: 'fingerprint-v1',
      serverUrl: 'ws://old',
      accountId: 'account-a',
      userId: 'user-a',
      getJwt: async () => 'old-token',
    });
    const open = vi.fn(async () => ({
      success: true,
      config: {
        workspacePath,
        orgId: 'org-a',
        documentId,
        title: 'Rotating doc',
        documentType: 'markdown',
        keyCustody: 'legacy-e2e' as const,
        orgKeyBase64: btoa(String.fromCharCode(...newKeyBytes)),
        orgKeyFingerprint: 'fingerprint-v2',
        serverUrl: 'ws://new',
        accountId: 'account-a',
        userId: 'user-a',
      },
    }));
    vi.stubGlobal('window', {
      electronAPI: {
        documentSync: {
          open,
          getJwt: vi.fn(async () => ({ success: true, jwt: 'new-token' })),
        },
      },
    });

    const refreshed = await resolveCollabConfigForUri(
      workspacePath,
      uri,
      documentId,
      'Rotating doc',
      'markdown',
      { forceRefresh: true },
    );

    expect(open).toHaveBeenCalledOnce();
    expect(refreshed).toMatchObject({
      orgKeyFingerprint: 'fingerprint-v2',
      serverUrl: 'ws://new',
    });
    const encryptingKey = await crypto.subtle.importKey(
      'raw', newKeyBytes, { name: 'AES-GCM' }, false, ['encrypt'],
    );
    const iv = new Uint8Array(12).fill(3);
    const plaintext = new TextEncoder().encode('post-rotation update');
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, encryptingKey, plaintext);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      refreshed!.documentKey!,
      encrypted,
    );
    expect(new TextDecoder().decode(decrypted)).toBe('post-rotation update');
  });
});
