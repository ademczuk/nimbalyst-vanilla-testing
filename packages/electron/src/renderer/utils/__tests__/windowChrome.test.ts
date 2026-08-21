// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reportResolvedTitleBarColors } from '../windowChrome';

afterEach(() => {
  document.documentElement.style.removeProperty('--nim-bg-secondary');
  document.documentElement.style.removeProperty('--nim-text');
  document.documentElement.style.removeProperty('--nim-bg');
  Reflect.deleteProperty(window, 'electronAPI');
});

describe('reportResolvedTitleBarColors', () => {
  it('reports the computed title-bar background and matching symbol color', () => {
    const setTitleBarOverlayColors = vi.fn();
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { setTitleBarOverlayColors },
    });
    document.documentElement.style.setProperty('--nim-bg-secondary', '#1e293b');
    document.documentElement.style.setProperty('--nim-text', 'rgb(248, 250, 252)');
    document.documentElement.style.setProperty('--nim-bg', '#0f172a');

    reportResolvedTitleBarColors();

    // --nim-bg rides along on this same report. It is main's only route to an
    // extension theme's real canvas colour, and dropping it silently reverts
    // the window to opening on a base light/dark stand-in.
    expect(setTitleBarOverlayColors).toHaveBeenCalledWith({
      color: '#1e293b',
      symbolColor: 'rgb(248, 250, 252)',
      backgroundColor: '#0f172a',
    });
  });

  it('does not send an incomplete computed theme', () => {
    const setTitleBarOverlayColors = vi.fn();
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { setTitleBarOverlayColors },
    });
    document.documentElement.style.setProperty('--nim-bg-secondary', '#fff');

    reportResolvedTitleBarColors();

    expect(setTitleBarOverlayColors).not.toHaveBeenCalled();
  });
});
