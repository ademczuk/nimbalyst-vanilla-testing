import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchTeamKeyStatusMock, findTeamForWorkspaceMock, safeHandleMock, handlers } = vi.hoisted(() => {
  const handlers = new Map<string, (...args: any[]) => any>();
  return {
    fetchTeamKeyStatusMock: vi.fn(),
    findTeamForWorkspaceMock: vi.fn(),
    handlers,
    safeHandleMock: vi.fn((channel: string, handler: (...args: any[]) => any) => {
      handlers.set(channel, handler);
    }),
  };
});

vi.mock('electron', () => ({
  BrowserWindow: class {},
  dialog: {},
  net: { fetch: vi.fn() },
}));

vi.mock('../../utils/ipcRegistry', () => ({ safeHandle: safeHandleMock }));

vi.mock('../../utils/logger', () => ({
  logger: { main: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } },
}));

vi.mock('../../utils/collabSyncUrl', () => ({
  getCollabSyncWsUrl: () => 'wss://sync.test',
  getCollabSyncHttpUrl: () => 'https://sync.test',
}));

vi.mock('../../services/StytchAuthService', () => ({
  isAuthenticated: vi.fn(() => true),
  getStytchUserId: vi.fn(() => 'user-1'),
  getUserEmail: vi.fn(() => 'user@test.com'),
  getAuthState: vi.fn(() => ({ user: { name: { first_name: 'Test', last_name: 'User' } } })),
  getPersonalOrgId: vi.fn(() => 'personal-1'),
  getPersonalSessionJwt: vi.fn(() => 'personal-jwt'),
  refreshPersonalSession: vi.fn(async () => false),
}));

vi.mock('../../services/TeamService', () => ({
  findTeamForWorkspace: findTeamForWorkspaceMock,
  getOrgScopedJwt: vi.fn(async () => 'org-jwt'),
}));

vi.mock('../../services/jwtOrg', () => ({
  getOrgIdFromJwt: vi.fn(),
  getJwtExp: vi.fn(() => Date.now() + 60_000),
}));

vi.mock('../../services/OrgKeyService', () => ({
  getOrgKey: vi.fn(async () => null),
  getOrgKeyFingerprint: vi.fn(() => null),
  getOrCreateIdentityKeyPair: vi.fn(async () => undefined),
  uploadIdentityKeyToOrg: vi.fn(async () => undefined),
  fetchAndUnwrapOrgKey: vi.fn(async () => null),
  clearOrgKey: vi.fn(),
  fetchTeamKeyStatus: fetchTeamKeyStatusMock,
  getArchivedOrgKeys: vi.fn(() => []),
}));

vi.mock('../../utils/store', () => ({
  getWorkspaceState: vi.fn(() => ({})),
  updateWorkspaceState: vi.fn(),
}));

vi.mock('../../services/SyncManager', () => ({}));
vi.mock('../collabDocumentTypeResolver', () => ({}));
vi.mock('../../services/DocSyncService', () => ({}));
vi.mock('../../protocols/collabAssetProtocol', () => ({}));
vi.mock('../../services/CollabAssetUploader', () => ({}));
vi.mock('../../services/markdownAssetScanner', () => ({}));
vi.mock('../../services/CollabLocalOriginService', () => ({}));
vi.mock('../collabContentAdapterRegistration', () => ({}));

import { registerDocumentSyncHandlers } from '../DocumentSyncHandlers';

describe('document-sync:resolve-index-config single-flight (RC4)', () => {
  beforeEach(() => {
    handlers.clear();
    findTeamForWorkspaceMock.mockReset();
    fetchTeamKeyStatusMock.mockReset();
    fetchTeamKeyStatusMock.mockResolvedValue({ mode: 'server-managed', dekEpoch: 1, dekFingerprint: 'fp' });

    registerDocumentSyncHandlers();
  });

  it('collapses N concurrent calls for the same workspace into one findTeamForWorkspace resolution', async () => {
    let resolveTeam: (value: unknown) => void;
    findTeamForWorkspaceMock.mockImplementation(() => new Promise((resolve) => { resolveTeam = resolve; }));

    const handler = handlers.get('document-sync:resolve-index-config');
    expect(handler).toBeTruthy();

    const calls = Array.from({ length: 5 }, () => handler!(null, { workspacePath: '/workspace/one' }));
    await Promise.resolve();
    await Promise.resolve();
    resolveTeam!({ orgId: 'org-1', teamProjectId: null });

    const results = await Promise.all(calls);

    expect(findTeamForWorkspaceMock).toHaveBeenCalledTimes(1);
    for (const result of results) {
      expect(result).toEqual(expect.objectContaining({ success: true }));
    }
  });

  it('does not dedupe calls for different workspaces', async () => {
    findTeamForWorkspaceMock.mockImplementation(async (workspacePath: string) => ({
      orgId: workspacePath === '/workspace/one' ? 'org-1' : 'org-2',
      teamProjectId: null,
    }));

    const handler = handlers.get('document-sync:resolve-index-config')!;
    await Promise.all([
      handler(null, { workspacePath: '/workspace/one' }),
      handler(null, { workspacePath: '/workspace/two' }),
    ]);

    expect(findTeamForWorkspaceMock).toHaveBeenCalledTimes(2);
  });

  it('runs a fresh resolution for a later, non-overlapping call', async () => {
    findTeamForWorkspaceMock.mockResolvedValue({ orgId: 'org-1', teamProjectId: null });

    const handler = handlers.get('document-sync:resolve-index-config')!;
    await handler(null, { workspacePath: '/workspace/one' });
    await handler(null, { workspacePath: '/workspace/one' });

    expect(findTeamForWorkspaceMock).toHaveBeenCalledTimes(2);
  });
});
