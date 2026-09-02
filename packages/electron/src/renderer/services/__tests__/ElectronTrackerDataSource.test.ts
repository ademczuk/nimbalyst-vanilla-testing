// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import type { TrackerDataChange, TrackerDataCommand, TrackerItem } from '@nimbalyst/collab-client/trackers';
import { ElectronTrackerDataSource, type ElectronTrackerDataSourceIpc } from '../ElectronTrackerDataSource';

function item(id: string, workspace = '/workspace/one'): TrackerItem {
  return {
    id,
    type: 'task',
    title: id,
    status: 'open',
    module: '',
    workspace,
    lastIndexed: new Date(0),
  };
}

function createIpc(invoke: ElectronTrackerDataSourceIpc['invoke']) {
  const handlers = new Map<string, (value: any) => void>();
  const cleanups = new Map<string, ReturnType<typeof vi.fn>>();
  const send = vi.fn();
  const on = vi.fn((channel: string, callback: (value: any) => void) => {
    handlers.set(channel, callback);
    const cleanup = vi.fn();
    cleanups.set(channel, cleanup);
    return cleanup;
  });
  return {
    ipc: { invoke, send, on } satisfies ElectronTrackerDataSourceIpc,
    handlers,
    cleanups,
    send,
  };
}

describe('ElectronTrackerDataSource', () => {
  it('projects snapshots and translates scoped IPC events into contract changes', async () => {
    let listedItems = [item('one')];
    let savedViews = [{ viewId: 'mine', payload: '{"name":"Mine"}' }];
    const presence = [{ teamMemberId: 'member-bob', displayName: 'Bob', avatarUrl: null }];
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'document-service:tracker-items-list') return listedItems;
      if (channel === 'tracker-saved-views:list') return savedViews;
      if (channel === 'tracker-sync:get-presence') return presence;
      if (channel === 'tracker-sync:get-status') {
        return { status: 'connected', projectId: 'project-1' };
      }
      throw new Error(`Unexpected channel: ${channel}`);
    });
    const { ipc, handlers, cleanups, send } = createIpc(invoke);
    const source = new ElectronTrackerDataSource({
      workspacePath: '/workspace/one',
      ipc,
    });
    const changes: TrackerDataChange[] = [];
    source.subscribe((change) => changes.push(change));

    await expect(source.snapshot()).resolves.toEqual({
      items: listedItems,
      savedViews,
      presence,
      sync: {
        workspacePath: '/workspace/one',
        status: 'connected',
        projectId: 'project-1',
      },
    });
    expect(source.status()).toEqual(expect.objectContaining({ status: 'connected' }));
    expect(send.mock.calls).toEqual([['document-service:tracker-items-watch'], ['document-service:metadata-watch']]);

    handlers.get('document-service:tracker-items-changed')?.({
      added: [item('local'), item('foreign', '/workspace/two')],
      updated: [item('updated')],
      removed: ['removed'],
    });
    handlers.get('tracker-sync:status-changed')?.({
      workspacePath: '/workspace/two',
      status: 'error',
    });
    handlers.get('tracker-sync:status-changed')?.({
      workspacePath: '/workspace/one',
      status: 'syncing',
      shared: true,
    });
    handlers.get('tracker-sync:mutation-rejected')?.({
      workspacePath: '/workspace/one',
      itemId: 'local',
      code: 'custodyUnavailable',
    });
    handlers.get('tracker-sync:config-changed')?.({
      workspacePath: '/workspace/one',
      config: { issueKeyPrefix: 'NIM' },
    });
    handlers.get('tracker-sync:presence-changed')?.({
      workspacePath: '/workspace/one',
      members: presence,
    });

    listedItems = [item('metadata-refresh')];
    handlers.get('document-service:metadata-changed')?.(undefined);
    savedViews = [{ viewId: 'team', payload: '{"name":"Team"}' }];
    handlers.get('tracker-saved-views:changed')?.({
      workspacePath: '/workspace/two',
    });
    handlers.get('tracker-saved-views:changed')?.({
      workspacePath: '/workspace/one',
    });
    // The metadata-driven reload is coalesced on a trailing window, so give it
    // more than vi.waitFor's 1s default.
    await vi.waitFor(() => {
      expect(changes).toContainEqual({
        type: 'items-replaced',
        items: listedItems,
      });
      expect(changes).toContainEqual({
        type: 'saved-views-replaced',
        savedViews,
      });
    }, { timeout: 3000 });

    expect(changes).toEqual(
      expect.arrayContaining([
        { type: 'items-upserted', items: [item('local'), item('updated')] },
        { type: 'items-removed', itemIds: ['removed'] },
        {
          type: 'status',
          sync: {
            workspacePath: '/workspace/one',
            status: 'syncing',
            projectId: 'shared',
          },
        },
        {
          type: 'mutation-rejected',
          rejection: {
            workspacePath: '/workspace/one',
            itemId: 'local',
            code: 'custodyUnavailable',
          },
        },
        {
          type: 'config-changed',
          workspacePath: '/workspace/one',
          config: { issueKeyPrefix: 'NIM' },
        },
        { type: 'presence', members: presence },
      ]),
    );
    expect(changes).not.toContainEqual(
      expect.objectContaining({
        type: 'status',
        sync: expect.objectContaining({ status: 'error' }),
      }),
    );

    source.dispose();
    expect([...cleanups.values()].every((cleanup) => cleanup.mock.calls.length === 1)).toBe(true);
  });

  it('maps every host command to the existing IPC call and preserves its result shape', async () => {
    const sharedRows = [{ viewId: 'team', payload: '{"name":"Team"}' }];
    const hostResult = { success: true, item: item('result') };
    const invoke = vi.fn(async (channel: string) =>
      channel.startsWith('tracker-saved-views:') ? sharedRows : hostResult,
    );
    const { ipc } = createIpc(invoke);
    const source = new ElectronTrackerDataSource({
      workspacePath: '/workspace/one',
      ipc,
    });
    const cases: Array<{
      command: TrackerDataCommand;
      expected: [string, ...unknown[]];
      savedViews?: boolean;
    }> = [
      {
        command: { type: 'list-items' },
        expected: ['document-service:tracker-items-list'],
      },
      {
        command: { type: 'refresh-items' },
        expected: ['document-service:refresh-workspace'],
      },
      {
        command: {
          type: 'create-item',
          item: {
            id: 'new',
            type: 'task',
            title: 'New',
            status: 'open',
            priority: 'medium',
            workspace: '/workspace/one',
          },
        },
        expected: ['document-service:create-tracker-item', expect.objectContaining({ id: 'new' })],
      },
      {
        command: {
          type: 'update-item',
          input: { itemId: 'one', updates: { status: 'done' } },
        },
        expected: ['document-service:update-tracker-item', { itemId: 'one', updates: { status: 'done' } }],
      },
      {
        command: {
          type: 'update-items',
          input: {
            entries: [{ itemId: 'one', storeUpdates: { status: 'done' } }],
          },
        },
        expected: ['document-service:update-tracker-items', expect.objectContaining({ entries: expect.any(Array) })],
      },
      {
        command: { type: 'archive-item', itemId: 'one', archive: true },
        expected: ['document-service:tracker-item-archive', { itemId: 'one', archive: true }],
      },
      {
        command: { type: 'delete-item', itemId: 'one' },
        expected: ['document-service:tracker-item-delete', { itemId: 'one' }],
      },
      {
        command: {
          type: 'update-item-content',
          itemId: 'one',
          content: { root: {} },
        },
        expected: ['document-service:tracker-item-update-content', { itemId: 'one', content: { root: {} } }],
      },
      {
        command: { type: 'add-comment', itemId: 'one', body: 'Hello' },
        expected: ['document-service:tracker-item-add-comment', { itemId: 'one', body: 'Hello' }],
      },
      {
        command: {
          type: 'update-comment',
          itemId: 'one',
          commentId: 'comment-1',
          deleted: true,
        },
        expected: [
          'document-service:tracker-item-update-comment',
          { itemId: 'one', commentId: 'comment-1', deleted: true },
        ],
      },
      {
        command: { type: 'share-saved-view', savedView: sharedRows[0] },
        expected: ['tracker-saved-views:share', '/workspace/one', sharedRows[0]],
        savedViews: true,
      },
      {
        command: { type: 'unshare-saved-view', viewId: 'team' },
        expected: ['tracker-saved-views:unshare', '/workspace/one', 'team'],
        savedViews: true,
      },
      {
        command: { type: 'reconnect' },
        expected: ['tracker-sync:connect', { workspacePath: '/workspace/one' }],
      },
    ];

    for (const testCase of cases) {
      invoke.mockClear();
      const result = await source.command(testCase.command);
      expect(invoke).toHaveBeenCalledWith(...testCase.expected);
      if (testCase.command.type === 'list-items') {
        expect(result.items).toEqual([]);
      } else if (testCase.savedViews) {
        expect(result).toEqual({ ok: true, savedViews: sharedRows });
      } else {
        expect(result).toEqual({ ok: true, result: hostResult });
      }
    }
  });

  it('collapses a burst of metadata changes into a single full item reload', async () => {
    vi.useFakeTimers();
    try {
      let resolveList: ((items: TrackerItem[]) => void) | null = null;
      const invoke = vi.fn(async (channel: string) => {
        if (channel !== 'document-service:tracker-items-list') return [];
        return new Promise<TrackerItem[]>((resolve) => {
          resolveList = resolve;
        });
      });
      const { ipc, handlers } = createIpc(invoke);
      const source = new ElectronTrackerDataSource({ workspacePath: '/workspace/one', ipc });
      const changes: TrackerDataChange[] = [];
      source.subscribe((change) => changes.push(change));

      // Typing inside a frontmatter block: one metadata change per keystroke.
      const fire = handlers.get('document-service:metadata-changed')!;
      for (let i = 0; i < 20; i++) {
        fire(undefined);
        await vi.advanceTimersByTimeAsync(40);
      }
      // 800ms of keystrokes 40ms apart used to be 20 full-list fetches.
      expect(invoke).toHaveBeenCalledTimes(1);

      // A change arriving while the reload is in flight does not start a second
      // concurrent fetch -- it is served by one trailing pass after it settles.
      fire(undefined);
      fire(undefined);
      await vi.advanceTimersByTimeAsync(600);
      expect(invoke).toHaveBeenCalledTimes(1);

      resolveList!([item('one')]);
      await vi.advanceTimersByTimeAsync(600);
      expect(invoke).toHaveBeenCalledTimes(2);
      expect(changes).toContainEqual({ type: 'items-replaced', items: [item('one')] });

      source.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
