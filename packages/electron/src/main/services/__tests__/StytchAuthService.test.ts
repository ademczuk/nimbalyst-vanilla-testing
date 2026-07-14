import { beforeEach, describe, expect, it, vi } from 'vitest';

const { files, fetchMock } = vi.hoisted(() => ({
  files: new Map<string, Buffer>(),
  fetchMock: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/mock/user-data') },
  net: { fetch: fetchMock },
  safeStorage: { isEncryptionAvailable: vi.fn(() => false) },
  shell: { openExternal: vi.fn() },
}));

vi.mock('fs', () => ({
  existsSync: vi.fn((filePath: string) => files.has(filePath)),
  readFileSync: vi.fn((filePath: string) => files.get(filePath)),
  writeFileSync: vi.fn((filePath: string, data: string | Buffer) => {
    files.set(filePath, Buffer.isBuffer(data) ? data : Buffer.from(data));
  }),
  unlinkSync: vi.fn((filePath: string) => files.delete(filePath)),
}));

vi.mock('@nimbalyst/runtime', () => ({
  STYTCH_CONFIG: {
    live: { projectId: 'test', publicToken: 'test', apiBase: 'https://test.invalid' },
  },
  asPersonalJwt: (jwt: string) => jwt,
  asPersonalMemberId: (id: string) => id,
}));

vi.mock('../../utils/store', () => ({
  getSessionSyncConfig: vi.fn(() => ({ serverUrl: 'https://sync.example' })),
  setSessionSyncConfig: vi.fn(),
}));

vi.mock('../../utils/logger', () => ({
  logger: {
    main: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  },
}));

vi.mock('../analytics/AnalyticsService', () => ({
  AnalyticsService: {
    getInstance: () => ({ sendEvent: vi.fn() }),
  },
}));

vi.mock('../SilentTeamEncryptionMigration', () => ({
  resetSilentMigrationScanState: vi.fn(),
}));

import {
  getPersonalSessionJwt,
  handleAuthCallback,
  refreshSession,
} from '../StytchAuthService';

function createJwt(payload: Record<string, unknown>): string {
  return [
    Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    'signature',
  ].join('.');
}

describe('StytchAuthService personal JWT refresh', () => {
  beforeEach(() => {
    files.clear();
    fetchMock.mockReset();
  });

  it('replaces an expired personal JWT after refreshing a personal-org session', async () => {
    const personalUserId = 'member-personal';
    const personalOrgId = 'org-personal';
    const expiredPersonalJwt = createJwt({
      sub: personalUserId,
      exp: Math.floor(Date.now() / 1000) - 60,
    });
    const freshPersonalJwt = createJwt({
      sub: personalUserId,
      exp: Math.floor(Date.now() / 1000) + 300,
    });

    await handleAuthCallback({
      sessionToken: 'stale-session-token',
      sessionJwt: expiredPersonalJwt,
      userId: personalUserId,
      orgId: personalOrgId,
    });

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        session_token: 'fresh-session-token',
        session_jwt: freshPersonalJwt,
        user_id: personalUserId,
        org_id: personalOrgId,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    });

    expect(getPersonalSessionJwt()).toBe(expiredPersonalJwt);
    await expect(refreshSession('https://sync.example')).resolves.toBe(true);
    expect(getPersonalSessionJwt()).toBe(freshPersonalJwt);
  });
});
