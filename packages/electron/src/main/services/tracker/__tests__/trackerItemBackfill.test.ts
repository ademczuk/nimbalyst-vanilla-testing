// @vitest-environment node

/**
 * The reconnect drain for tracker items left `pending` by an offline write.
 *
 * The regression under test is invisible at the call site: the drain used to
 * be guarded by a process-lifetime `Set`, so it ran on the FIRST `connected`
 * and never again. A mid-session disconnect -- laptop sleeps, wifi drops --
 * left every edit at `sync_status='pending'` until the next app launch, and if
 * a teammate touched the same row in the meantime `applyRemoteItem` stamped it
 * `synced` and the edit was gone with no rejection and no log line (NIM-3657).
 *
 * Schemas, saved views and navigation all push at the end of every bootstrap.
 * Items are the lane that did not, so "drains on the second connect too" is
 * the assertion that matters here.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { drainPendingTrackerItems, type TrackerItemBackfillPort } from '../trackerItemBackfill';

const WORKSPACE = '/tmp/workspace';

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bug-1',
    type: 'bug',
    workspace: WORKSPACE,
    sync_id: null,
    sync_status: 'pending',
    data: {},
    ...overrides,
  };
}

function makePort(rows: Array<Record<string, unknown>>): TrackerItemBackfillPort & {
  upsertItem: ReturnType<typeof vi.fn>;
  deleteItem: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
} {
  return {
    query: vi.fn(async () => ({ rows: [...rows] })),
    upsertItem: vi.fn(async () => {}),
    deleteItem: vi.fn(async () => {}),
    resolvePolicy: () => ({ sharing: 'team', draftByDefault: false }),
    toItem: (row: any) => ({ id: row.id, type: row.type, workspace: row.workspace }) as any,
    log: { info: vi.fn(), warn: vi.fn() },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('drainPendingTrackerItems', () => {
  it('drains again on a later reconnect instead of once per process', async () => {
    const port = makePort([makeRow()]);

    const first = await drainPendingTrackerItems(WORKSPACE, port);
    const second = await drainPendingTrackerItems(WORKSPACE, port);

    expect(first.queued).toBe(1);
    // The whole point: a second connect in the same process must push again.
    expect(second.queued).toBe(1);
    expect(port.upsertItem).toHaveBeenCalledTimes(2);
  });

  it('does not start a second pass while one is still in flight', async () => {
    let releaseQuery: () => void = () => {};
    const blocked = new Promise<void>((resolve) => { releaseQuery = resolve; });
    const port = makePort([makeRow()]);
    port.query.mockImplementation(async () => {
      await blocked;
      return { rows: [makeRow()] };
    });

    const inFlight = drainPendingTrackerItems(WORKSPACE, port);
    const overlapping = await drainPendingTrackerItems(WORKSPACE, port);
    releaseQuery();
    await inFlight;

    expect(overlapping.skippedRun).toBe(true);
    expect(port.upsertItem).toHaveBeenCalledTimes(1);
  });

  it('tombstones an item that was published before and is now a draft', async () => {
    const port = makePort([makeRow({ sync_id: 42 })]);
    port.resolvePolicy = () => ({ sharing: 'team', draftByDefault: true });

    const result = await drainPendingTrackerItems(WORKSPACE, port);

    expect(result.deleted).toBe(1);
    expect(port.deleteItem).toHaveBeenCalledWith('bug-1');
    // Reset locally so the next reconnect does not re-delete it.
    expect(port.query).toHaveBeenCalledWith(
      expect.stringContaining("sync_status = 'local'"),
      ['bug-1'],
    );
  });

  it('leaves a never-published draft on the machine', async () => {
    const port = makePort([makeRow()]);
    port.resolvePolicy = () => ({ sharing: 'personal', draftByDefault: false });

    const result = await drainPendingTrackerItems(WORKSPACE, port);

    expect(result.skipped).toBe(1);
    expect(port.upsertItem).not.toHaveBeenCalled();
    expect(port.deleteItem).not.toHaveBeenCalled();
  });

  it('keeps draining after one item fails to push', async () => {
    const port = makePort([makeRow({ id: 'bug-1' }), makeRow({ id: 'bug-2' })]);
    port.upsertItem.mockRejectedValueOnce(new Error('socket closed'));

    const result = await drainPendingTrackerItems(WORKSPACE, port);

    expect(result.queued).toBe(1);
    expect(port.upsertItem).toHaveBeenCalledTimes(2);
    // The failed row keeps its `pending` status, so the next connect retries it.
    expect(port.log.warn).toHaveBeenCalled();
  });
});
