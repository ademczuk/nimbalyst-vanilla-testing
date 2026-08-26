// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const handlers = new Map<string, (...args: any[]) => any>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
      handlers.set(channel, handler);
    }),
  },
}));

import { safeHandle, getIpcStatsSnapshot } from '../ipcRegistry';

function statsFor(channel: string) {
  return getIpcStatsSnapshot().find((row) => row.channel === channel);
}

describe('ipcRegistry invocation stats', () => {
  beforeEach(() => {
    handlers.clear();
  });

  it('times ordinary channels but leaves agent-turn channels out of the stats', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Well above IPC_SLOW_THRESHOLD_MS so a timed channel would log [IpcSlow].
    const slowHandler = () =>
      new Promise((resolve) => setTimeout(() => resolve('done'), 1100));

    safeHandle('workspace:list', slowHandler);
    safeHandle('ai:sendMessage', slowHandler);

    await expect(handlers.get('workspace:list')!({} as any)).resolves.toBe('done');
    await expect(handlers.get('ai:sendMessage')!({} as any)).resolves.toBe('done');

    expect(statsFor('workspace:list')?.callCount).toBe(1);
    expect(statsFor('ai:sendMessage')).toBeUndefined();
    expect(warn.mock.calls.flat().join(' ')).not.toContain('ai:sendMessage');
    warn.mockRestore();
  }, 10_000);
});
