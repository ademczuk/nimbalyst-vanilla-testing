// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { ipcMain } from 'electron';
import { requestFromRenderer } from '../rendererRequest';

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  return { ipcMain: new EventEmitter() };
});

describe('requestFromRenderer', () => {
  it('deregisters its one-shot listener when the renderer never replies', async () => {
    vi.useFakeTimers();
    const sent: Array<{ resultChannel: string }> = [];
    const window = {
      webContents: { send: (_channel: string, payload: { resultChannel: string }) => sent.push(payload) },
    } as unknown as BrowserWindow;

    const pending = requestFromRenderer(window, 'mcp:test', { a: 1 }, { timeoutMs: 5000 });
    const { resultChannel } = sent[0];
    expect(ipcMain.listenerCount(resultChannel)).toBe(1);

    await vi.advanceTimersByTimeAsync(5000);

    await expect(pending).resolves.toEqual({ status: 'timedOut' });
    // A leaked listener per timeout is invisible until MaxListenersExceededWarning.
    expect(ipcMain.listenerCount(resultChannel)).toBe(0);
    vi.useRealTimers();
  });
});
