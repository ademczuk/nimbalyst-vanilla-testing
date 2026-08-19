// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockOnTrackerItemApplied } = vi.hoisted(() => ({
  mockOnTrackerItemApplied: vi.fn<(listener: any) => () => void>(),
}));

vi.mock('../../TrackerSyncManager', () => ({
  onTrackerItemApplied: mockOnTrackerItemApplied,
}));

import { awaitServerIssueKey } from '../awaitServerIssueKey';

function dbReturning(issueKey: string | null) {
  return {
    async query<T = unknown>(): Promise<{ rows: T[] }> {
      return { rows: [{ issue_key: issueKey }] as T[] };
    },
  };
}

describe('awaitServerIssueKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOnTrackerItemApplied.mockReturnValue(() => {});
  });

  it('resolves with the server key when the ack arrives while waiting', async () => {
    let emit: ((workspacePath: string, applied: any) => void) | null = null;
    mockOnTrackerItemApplied.mockImplementation((listener) => {
      emit = listener;
      return () => { emit = null; };
    });

    const pending = awaitServerIssueKey(dbReturning(null), 'bug_1', 1000);
    // Let the pre-read settle so the listener is the only thing left to fire.
    await Promise.resolve();
    await Promise.resolve();
    emit!('/tmp/ws', { itemId: 'bug_1', issueKey: 'NIM-2615' });

    await expect(pending).resolves.toBe('NIM-2615');
  });

  it('returns the key from the row when the ack landed before we subscribed', async () => {
    // The listener never fires in this case, so a subscribe-only implementation
    // would hang until the timeout and report the provisional key.
    await expect(awaitServerIssueKey(dbReturning('NIM-2615'), 'bug_1', 1000))
      .resolves.toBe('NIM-2615');
    expect(mockOnTrackerItemApplied).toHaveBeenCalled();
  });

  it('gives up with no key when publication does not reach the server', async () => {
    await expect(awaitServerIssueKey(dbReturning(null), 'bug_1', 5)).resolves.toBeNull();
  });

  it('keeps the timeout bounded when the pre-read stalls', async () => {
    const stalledDb = {
      query: async <T = unknown>(): Promise<{ rows: T[] }> => new Promise(() => {}),
    };

    await expect(awaitServerIssueKey(stalledDb, 'bug_1', 5)).resolves.toBeNull();
  });

  it('ignores acks for other items and never returns a local key', async () => {
    let emit: ((workspacePath: string, applied: any) => void) | null = null;
    mockOnTrackerItemApplied.mockImplementation((listener) => {
      emit = listener;
      return () => {};
    });

    const pending = awaitServerIssueKey(dbReturning(null), 'bug_1', 40);
    await Promise.resolve();
    await Promise.resolve();
    emit!('/tmp/ws', { itemId: 'bug_OTHER', issueKey: 'NIM-999' });
    emit!('/tmp/ws', { itemId: 'bug_1', issueKey: 'LC-3' });

    await expect(pending).resolves.toBeNull();
  });

  it('unsubscribes once settled so creates do not leak listeners', async () => {
    const unsubscribe = vi.fn();
    mockOnTrackerItemApplied.mockReturnValue(unsubscribe);

    await awaitServerIssueKey(dbReturning('NIM-1'), 'bug_1', 1000);

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('keeps an existing key immutable when a conflicting ack arrives during the read', async () => {
    let emit: ((workspacePath: string, applied: any) => void) | null = null;
    mockOnTrackerItemApplied.mockImplementation((listener) => {
      emit = listener;
      return () => {};
    });
    let resolveRead: ((value: { rows: Array<{ issue_key: string }> }) => void) | null = null;
    const delayedDb = {
      query: async <T = unknown>(): Promise<{ rows: T[] }> => new Promise((resolve) => {
        resolveRead = resolve as typeof resolveRead;
      }),
    };

    const pending = awaitServerIssueKey(delayedDb, 'bug_1', 1000);
    emit!('/tmp/ws', { itemId: 'bug_1', issueKey: 'NIM-99' });
    resolveRead!({ rows: [{ issue_key: 'NIM-42' }] });

    await expect(pending).resolves.toBe('NIM-42');
  });
});
