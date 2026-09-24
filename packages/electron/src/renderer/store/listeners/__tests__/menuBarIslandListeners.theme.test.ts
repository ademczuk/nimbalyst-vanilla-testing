import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getBaseThemeColors } from '@nimbalyst/runtime/editor/themes/palette';
import { initMenuBarIslandListener } from '../menuBarIslandListeners';

// The island does not run useTheme, and NimbalystTheme.css only carries light
// fallbacks on :root, so the listener must write the --nim-* colors itself.
describe('menu bar island theme', () => {
  let resolvedTheme = 'dark';
  let themeHandler: (() => void) | null = null;
  let cleanup: () => void = () => {};

  beforeEach(() => {
    themeHandler = null;
    document.documentElement.removeAttribute('style');
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      getResolvedThemeSync: () => resolvedTheme,
      on: (channel: string, handler: () => void) => {
        if (channel === 'theme-change') themeHandler = handler;
        return () => {};
      },
      invoke: () => Promise.resolve({}),
    };
  });

  afterEach(() => cleanup());

  it('applies the resolved theme colors at init and on theme-change', () => {
    resolvedTheme = 'dark';
    cleanup = initMenuBarIslandListener();
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--nim-bg')).toBe(getBaseThemeColors(true).bg);
    expect(root.classList.contains('dark-theme')).toBe(true);

    resolvedTheme = 'light';
    themeHandler!();
    expect(root.style.getPropertyValue('--nim-bg')).toBe(getBaseThemeColors(false).bg);
    expect(root.classList.contains('dark-theme')).toBe(false);
  });
});
