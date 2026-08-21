// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Which colour a window opens on is decided entirely in the main process,
// before any renderer exists, so none of this is observable on screen until
// the flash has already happened. These cover the decision itself.
const { store, nativeTheme, windows } = vi.hoisted(() => ({
  store: {
    theme: 'light' as string,
    themeIsDark: undefined as boolean | undefined,
    themeBackgroundColor: undefined as string | undefined,
  },
  nativeTheme: { shouldUseDarkColors: false, themeSource: 'system' },
  windows: [] as Array<{ setBackgroundColor: ReturnType<typeof vi.fn>; webContents: { send: ReturnType<typeof vi.fn> } }>,
}));

vi.mock('electron', () => ({
  nativeTheme,
  BrowserWindow: { getAllWindows: () => windows },
}));

vi.mock('../../utils/store', () => ({
  getTheme: () => store.theme,
  getThemeIsDark: () => store.themeIsDark,
  getThemeBackgroundColor: () => store.themeBackgroundColor,
  clearThemeBackgroundColor: () => { store.themeBackgroundColor = undefined; },
}));

vi.mock('../../window/windowChrome', () => ({
  getTitleBarOverlayColors: (fallback: unknown) => fallback,
  resetTitleBarOverlayColors: vi.fn(),
}));

import { getBackgroundColor, updateWindowTitleBars } from '../ThemeManager';

beforeEach(() => {
  store.theme = 'light';
  store.themeIsDark = undefined;
  store.themeBackgroundColor = undefined;
  nativeTheme.shouldUseDarkColors = false;
  windows.length = 0;
});

describe('getBackgroundColor', () => {
  it('prefers the colour the renderer reported over the base-theme guess', () => {
    // An extension theme's colours live in the renderer's theme registry, so
    // this reported value is the only way main can know solarized-light is
    // #fdf6e3 and not plain white.
    store.theme = 'solarized-light';
    store.themeIsDark = false;
    store.themeBackgroundColor = '#fdf6e3';

    expect(getBackgroundColor()).toBe('#fdf6e3');
  });

  it('falls back per base theme when nothing has been reported yet', () => {
    store.theme = 'light';
    expect(getBackgroundColor()).toBe('#ffffff');

    store.theme = 'dark';
    expect(getBackgroundColor()).toBe('#2d2d2d');

    // crystal-dark is its own colour, not the generic dark one. WindowManager
    // used to be the only place that knew this.
    store.theme = 'crystal-dark';
    expect(getBackgroundColor()).toBe('#0f172a');
  });

  it('resolves system to the OS preference', () => {
    store.theme = 'system';
    nativeTheme.shouldUseDarkColors = true;
    expect(getBackgroundColor()).toBe('#2d2d2d');
  });

  it('forgets the reported colour on a theme change', () => {
    // Otherwise switching from a light extension theme to dark would persist
    // #fdf6e3 and open the next launch on a cream flash before going dark.
    store.theme = 'solarized-light';
    store.themeBackgroundColor = '#fdf6e3';

    store.theme = 'dark';
    store.themeIsDark = true;
    updateWindowTitleBars();

    expect(getBackgroundColor()).toBe('#2d2d2d');
  });
});
