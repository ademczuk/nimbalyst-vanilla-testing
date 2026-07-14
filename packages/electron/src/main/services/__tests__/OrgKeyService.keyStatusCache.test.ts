import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

vi.mock('electron', () => ({
  safeStorage: { isEncryptionAvailable: vi.fn(() => false) },
  app: { getPath: vi.fn(() => '/mock/user-data') },
  net: { fetch: fetchMock },
}));

vi.mock('../../utils/logger', () => ({
  logger: {
    main: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  },
}));

vi.mock('../../utils/ipcRegistry', () => ({
  safeHandle: vi.fn(),
}));

vi.mock('../../utils/collabSyncUrl', () => ({
  getCollabSyncHttpUrl: () => 'https://sync.test',
}));

vi.mock('../StytchAuthService', () => ({
  getSessionJwt: vi.fn(() => 'session-jwt'),
  isAuthenticated: vi.fn(() => true),
}));

vi.mock('../TeamService', () => ({
  getOrgScopedJwt: vi.fn(async () => 'org-jwt'),
}));

vi.mock('@nimbalyst/runtime/sync', () => ({
  ECDHKeyManager: class {
    static generateDocumentKey = vi.fn();
    deserializeKeyPair = vi.fn();
    serializeKeyPair = vi.fn();
    generateKeyPair = vi.fn();
  },
}));

import { fetchTeamKeyStatus, invalidateTeamKeyStatusCache, setTeamKeyCustodyMode } from '../OrgKeyService';

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body };
}

function keyStatusCallCount(): number {
  return fetchMock.mock.calls.filter((call: unknown[]) => (call[0] as string).includes('/key-status')).length;
}

describe('OrgKeyService key-status cache (RC2)', () => {
  beforeEach(() => {
    invalidateTeamKeyStatusCache();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/key-status')) {
        return jsonResponse({ mode: 'legacy-e2e', dekEpoch: null, dekFingerprint: null });
      }
      if (url.includes('/set-key-custody-mode')) {
        return jsonResponse({ success: true });
      }
      return jsonResponse({});
    });
  });

  afterEach(() => {
    invalidateTeamKeyStatusCache();
  });

  it('collapses N concurrent fetchTeamKeyStatus calls for the same org into one GET', async () => {
    const results = await Promise.all([
      fetchTeamKeyStatus('org-1', 'jwt'),
      fetchTeamKeyStatus('org-1', 'jwt'),
      fetchTeamKeyStatus('org-1', 'jwt'),
      fetchTeamKeyStatus('org-1', 'jwt'),
      fetchTeamKeyStatus('org-1', 'jwt'),
    ]);

    expect(keyStatusCallCount()).toBe(1);
    for (const result of results) {
      expect(result).toEqual({ mode: 'legacy-e2e', dekEpoch: null, dekFingerprint: null });
    }
  });

  it('reuses the cached status for a second call to the same org shortly after', async () => {
    await fetchTeamKeyStatus('org-1', 'jwt');
    await fetchTeamKeyStatus('org-1', 'jwt');

    expect(keyStatusCallCount()).toBe(1);
  });

  it('fetches independently per org', async () => {
    await fetchTeamKeyStatus('org-1', 'jwt');
    await fetchTeamKeyStatus('org-2', 'jwt');

    expect(keyStatusCallCount()).toBe(2);
  });

  it('setTeamKeyCustodyMode invalidates the cache for that org so the next call refetches', async () => {
    await fetchTeamKeyStatus('org-1', 'jwt');
    expect(keyStatusCallCount()).toBe(1);

    await setTeamKeyCustodyMode('org-1', 'server-managed', 'jwt');

    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/key-status')) {
        return jsonResponse({ mode: 'server-managed', dekEpoch: 1, dekFingerprint: 'fp' });
      }
      return jsonResponse({});
    });

    const status = await fetchTeamKeyStatus('org-1', 'jwt');
    expect(keyStatusCallCount()).toBe(2);
    expect(status.mode).toBe('server-managed');
  });
});
