// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { focus: vi.fn() } }));
vi.mock('../../utils/logger', () => ({
  logger: { main: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

import { revealReadyWindow } from '../revealReadyWindow';
import {
  beginStartupActivation,
  registerStartupWindow,
  resetStartupActivationForTests,
} from '../StartupActivation';

class TestWindow {
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  readonly calls: string[] = [];

  isDestroyed = vi.fn(() => false);
  show = vi.fn(() => this.calls.push('show'));
  showInactive = vi.fn(() => this.calls.push('showInactive'));
  focus = vi.fn(() => this.calls.push('focus'));
  maximize = vi.fn(() => this.calls.push('maximize'));

  once(event: string, listener: (...args: unknown[]) => void) {
    const wrapped = (...args: unknown[]) => {
      this.removeListener(event, wrapped);
      listener(...args);
    };
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(wrapped);
    this.listeners.set(event, listeners);
    return this;
  }

  removeListener(event: string, listener: (...args: unknown[]) => void) {
    this.listeners.get(event)?.delete(listener);
    return this;
  }
}

describe('revealReadyWindow', () => {
  beforeEach(() => {
    resetStartupActivationForTests();
  });

  // The regression this whole mechanism exists for: gating show() on "the app
  // is currently active" meant a window whose ready-to-show landed while the
  // user was in another app was never shown at all.
  it('reveals a startup window even though the app never became active', () => {
    const window = new TestWindow();
    beginStartupActivation({ platform: 'darwin' });
    registerStartupWindow(window);

    revealReadyWindow(window, { showInactive: true, startupReveal: true }, undefined);

    expect(window.calls).toEqual(['showInactive']);
  });

  // Greg's review (PR #1079): maximize() shows a hidden window, so it has to
  // run after the show it belongs to, never before it.
  it('maximizes a restored window only after revealing it', () => {
    const window = new TestWindow();
    beginStartupActivation({ platform: 'darwin' });
    registerStartupWindow(window);

    revealReadyWindow(
      window,
      { showInactive: true, startupReveal: true },
      { isMaximized: true },
    );

    expect(window.calls).toEqual(['showInactive', 'maximize']);
  });

  it('activates a window opened after startup has finished', () => {
    const window = new TestWindow();

    // Same call shape as a file opened from Finder while Nimbalyst is running:
    // the coordinator is not accepting members, so this window shows normally.
    revealReadyWindow(window, { startupReveal: true }, undefined);

    expect(window.calls).toEqual(['show']);
  });
});
