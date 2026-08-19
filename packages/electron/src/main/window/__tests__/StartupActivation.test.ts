// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ focus: vi.fn() }));

vi.mock('electron', () => ({ app: { focus: mocks.focus } }));
vi.mock('../../utils/logger', () => ({
  logger: { main: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

import {
  beginStartupActivation,
  finishStartupWindowCreation,
  notifyStartupWindowRevealed,
  onStartupActivated,
  registerStartupWindow,
  resetStartupActivationForTests,
} from '../StartupActivation';

class TestWindow {
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  readonly calls: string[] = [];
  destroyed = false;

  isDestroyed = () => this.destroyed;
  show = vi.fn(() => this.calls.push('show'));
  focus = vi.fn(() => this.calls.push('focus'));

  once(event: string, listener: (...args: unknown[]) => void) {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  removeListener(event: string, listener: (...args: unknown[]) => void) {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  close() {
    this.destroyed = true;
    for (const listener of [...(this.listeners.get('closed') ?? [])]) listener();
  }
}

describe('StartupActivation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.focus.mockReset();
    resetStartupActivationForTests();
    beginStartupActivation({ platform: 'darwin' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('foregrounds once, after the last startup window is on screen', () => {
    const first = new TestWindow();
    const last = new TestWindow();
    // Session restore registers in ascending focus order and claims frontmost
    // each time, so the most recently focused window wins.
    registerStartupWindow(first, { frontmost: true });
    registerStartupWindow(last, { frontmost: true });
    finishStartupWindowCreation();

    notifyStartupWindowRevealed(first);
    expect(mocks.focus).not.toHaveBeenCalled();

    notifyStartupWindowRevealed(last);
    expect(mocks.focus).toHaveBeenCalledTimes(1);
    expect(mocks.focus).toHaveBeenCalledWith({ steal: true });
    expect(last.calls).toEqual(['show', 'focus']);
    expect(first.calls).toEqual([]);
  });

  it('waits for window creation to finish before foregrounding', () => {
    const window = new TestWindow();
    registerStartupWindow(window, { frontmost: true });

    notifyStartupWindowRevealed(window);
    expect(mocks.focus).not.toHaveBeenCalled();

    finishStartupWindowCreation();
    expect(mocks.focus).toHaveBeenCalledTimes(1);
  });

  it('foregrounds through a painted window when another never becomes ready', () => {
    const painted = new TestWindow();
    const stuck = new TestWindow();
    registerStartupWindow(painted, { frontmost: true });
    registerStartupWindow(stuck);
    finishStartupWindowCreation();
    notifyStartupWindowRevealed(painted);

    expect(mocks.focus).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50_000);

    expect(mocks.focus).toHaveBeenCalledTimes(1);
    expect(painted.calls).toEqual(['show', 'focus']);
    expect(stuck.calls).toEqual([]);
  });

  // The 2026-08-11 trace: ready-to-show took 29.5s, so the old 15s wait gave
  // up, force-showed an empty window and stole focus for it. Waiting out the
  // timeout must never put an unpainted window on screen.
  it('waits for a first paint instead of foregrounding an empty window', () => {
    const slow = new TestWindow();
    registerStartupWindow(slow, { frontmost: true });
    finishStartupWindowCreation();

    vi.advanceTimersByTime(50_000);

    expect(mocks.focus).not.toHaveBeenCalled();
    expect(slow.calls).toEqual([]);

    notifyStartupWindowRevealed(slow);

    expect(mocks.focus).toHaveBeenCalledTimes(1);
    expect(slow.calls).toEqual(['show', 'focus']);
  });

  it('foregrounds only once when a second window paints after the wait', () => {
    const first = new TestWindow();
    const second = new TestWindow();
    registerStartupWindow(first);
    registerStartupWindow(second, { frontmost: true });
    finishStartupWindowCreation();

    vi.advanceTimersByTime(50_000);
    notifyStartupWindowRevealed(first);
    notifyStartupWindowRevealed(second);

    expect(mocks.focus).toHaveBeenCalledTimes(1);
    expect(second.calls).toEqual([]);
  });

  it('falls back to a revealed window when the frontmost one is closed', () => {
    const revealed = new TestWindow();
    const frontmost = new TestWindow();
    registerStartupWindow(revealed);
    registerStartupWindow(frontmost, { frontmost: true });
    finishStartupWindowCreation();

    notifyStartupWindowRevealed(revealed);
    frontmost.close();

    expect(mocks.focus).toHaveBeenCalledTimes(1);
    expect(revealed.calls).toEqual(['show', 'focus']);
  });

  it('never foregrounds a second time for windows opened after startup', () => {
    const startupWindow = new TestWindow();
    registerStartupWindow(startupWindow, { frontmost: true });
    finishStartupWindowCreation();
    notifyStartupWindowRevealed(startupWindow);
    expect(mocks.focus).toHaveBeenCalledTimes(1);

    const laterWindow = new TestWindow();
    expect(registerStartupWindow(laterWindow, { frontmost: true })).toBe(false);
    notifyStartupWindowRevealed(laterWindow);

    expect(mocks.focus).toHaveBeenCalledTimes(1);
    expect(laterWindow.calls).toEqual([]);
  });

  it('runs deferred actions once foregrounding has happened', () => {
    const openDevTools = vi.fn();
    const window = new TestWindow();
    registerStartupWindow(window, { frontmost: true });
    finishStartupWindowCreation();

    onStartupActivated(openDevTools);
    expect(openDevTools).not.toHaveBeenCalled();

    notifyStartupWindowRevealed(window);
    expect(openDevTools).toHaveBeenCalledTimes(1);

    // Anything registered afterwards runs immediately.
    const later = vi.fn();
    onStartupActivated(later);
    expect(later).toHaveBeenCalledTimes(1);
  });

  it('does not foreground when launch opened no windows', () => {
    finishStartupWindowCreation();
    expect(mocks.focus).not.toHaveBeenCalled();
  });
});
