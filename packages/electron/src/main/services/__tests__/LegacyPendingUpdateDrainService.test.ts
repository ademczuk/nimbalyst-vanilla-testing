// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const migrateLegacyPendingUpdate = vi.fn();
const updateWorkspaceState = vi.fn();
let workspaces: Array<{ workspacePath: string; pending: Record<string, unknown> }> = [];
let accountId: string | null = null;

vi.mock('../../utils/store', () => ({
  listLegacyPendingUpdateWorkspaces: () => workspaces,
  updateWorkspaceState: (...args: unknown[]) => updateWorkspaceState(...args),
  getWorkspaceState: () => ({ openCollabDocumentEntries: [] }),
}));
vi.mock('../CollabDocumentReplicaStore', () => ({
  getCollabDocumentReplicaStore: () => ({ migrateLegacyPendingUpdate }),
}));
vi.mock('../StytchAuthService', () => ({
  getPersonalUserId: () => accountId,
  getStytchUserId: () => null,
}));
vi.mock('../../utils/logger', () => ({
  logger: { main: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } },
}));

const entry = { mergedUpdateBase64: Buffer.from([1]).toString('base64'), updatedAt: 1 };

describe('drainAllLegacyPendingUpdates', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    accountId = null;
    workspaces = [{ workspacePath: '/ws', pending: { 'org:o:doc:d1': entry } }];
    const mod = await import('../LegacyPendingUpdateDrainService');
    mod.__resetLegacyPendingUpdateDrainForTests();
  });

  it('leaves entries alone when no account is signed in yet', async () => {
    const { drainAllLegacyPendingUpdates } = await import('../LegacyPendingUpdateDrainService');
    const result = await drainAllLegacyPendingUpdates();

    expect(result.skipped).toBe('no-account');
    expect(migrateLegacyPendingUpdate).not.toHaveBeenCalled();
    expect(updateWorkspaceState).not.toHaveBeenCalled();
  });

  it('drains on a later call once an account exists', async () => {
    const { drainAllLegacyPendingUpdates } = await import('../LegacyPendingUpdateDrainService');
    await drainAllLegacyPendingUpdates();

    // Startup ran too early; the auth hook retries.
    accountId = 'account-1';
    migrateLegacyPendingUpdate.mockResolvedValue(true);
    const result = await drainAllLegacyPendingUpdates();

    expect(result.migrated).toBe(1);
    expect(result.remaining).toBe(0);
    expect(updateWorkspaceState).toHaveBeenCalledOnce();
  });

  it('keeps an entry the replica store did not commit, and retries later', async () => {
    const { drainAllLegacyPendingUpdates } = await import('../LegacyPendingUpdateDrainService');
    accountId = 'account-1';
    migrateLegacyPendingUpdate.mockResolvedValue(false);

    const first = await drainAllLegacyPendingUpdates();
    expect(first.migrated).toBe(0);
    expect(first.remaining).toBe(1);
    expect(updateWorkspaceState).not.toHaveBeenCalled();

    // Not marked done, so a later call tries again rather than giving up.
    migrateLegacyPendingUpdate.mockResolvedValue(true);
    const second = await drainAllLegacyPendingUpdates();
    expect(second.migrated).toBe(1);
  });

  it('does not re-run once everything has drained', async () => {
    const { drainAllLegacyPendingUpdates } = await import('../LegacyPendingUpdateDrainService');
    accountId = 'account-1';
    migrateLegacyPendingUpdate.mockResolvedValue(true);

    await drainAllLegacyPendingUpdates();
    const again = await drainAllLegacyPendingUpdates();

    expect(again.skipped).toBe('already-drained');
    expect(migrateLegacyPendingUpdate).toHaveBeenCalledTimes(1);
  });
});
