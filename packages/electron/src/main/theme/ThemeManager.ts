import { BrowserWindow, nativeTheme } from 'electron';
import { getTheme, getThemeIsDark, getThemeBackgroundColor, clearThemeBackgroundColor } from '../utils/store';
import {
    getTitleBarOverlayColors,
    resetTitleBarOverlayColors,
} from '../window/windowChrome';

/**
 * Determine if the current theme is dark.
 * Only 'light' and 'dark' are true built-in themes.
 * For file-based themes, uses the stored isDark value from theme metadata.
 */
function isCurrentThemeDark(currentTheme: string): boolean {
    // Built-in themes
    if (currentTheme === 'light') return false;
    if (currentTheme === 'dark') return true;

    // System theme - check OS preference
    if (currentTheme === 'system') {
        return nativeTheme.shouldUseDarkColors;
    }

    // For file-based themes (crystal-dark, solarized-light, etc.), use stored isDark value
    // The isDark value is stored when the theme is selected
    return getThemeIsDark() ?? currentTheme.includes('dark');
}

// Function to update native theme
export function updateNativeTheme() {
    const currentTheme = getTheme();

    // Map to system/dark/light for nativeTheme
    let desired: 'system' | 'dark' | 'light';
    if (currentTheme === 'system') {
        desired = 'system';
    } else if (isCurrentThemeDark(currentTheme)) {
        desired = 'dark';
    } else {
        desired = 'light';
    }

    // Only set when it actually changes to avoid spurious 'updated' events
    if (nativeTheme.themeSource !== desired) {
        nativeTheme.themeSource = desired;
    }
}

// Function to update window title bar colors based on theme
export function updateWindowTitleBars() {
    const currentTheme = getTheme();
    const isDarkTheme = isCurrentThemeDark(currentTheme);

    // Do NOT touch nativeTheme.themeSource here to avoid triggering
    // nativeTheme 'updated' recursively. Only adjust window visuals.

    // Title bar colors for light and dark modes
    // For file-based themes, we use generic light/dark colors
    const titleBarColors = {
        dark: { color: '#1a1a1a', symbolColor: '#ffffff' },
        light: { color: '#ffffff', symbolColor: '#374151' }
    };

    // Select appropriate colors based on whether theme is dark or light
    const titleBarColor = isDarkTheme ? titleBarColors.dark : titleBarColors.light;

    // A main-process theme change invalidates the renderer-resolved color
    // until the renderer applies the new theme and reports its computed vars.
    // The remembered canvas colour is stale for the same reason, and unlike the
    // title bar it outlives the process, so it has to be dropped rather than
    // just reset — otherwise the next launch paints the old theme's colour.
    resetTitleBarOverlayColors(titleBarColor);
    clearThemeBackgroundColor();

    const backgroundColor = fallbackBackgroundColor(currentTheme);

    // Update all windows
    BrowserWindow.getAllWindows().forEach(window => {
        // Update background color
        window.setBackgroundColor(backgroundColor);

        // Send theme-change event to all windows
        // Each window's renderer listens to this and updates its own UI
        window.webContents.send('theme-change', currentTheme);
    });
}

// Get title bar colors for current theme
export function getTitleBarColors() {
    const isDarkTheme = isCurrentThemeDark(getTheme());

    const titleBarColors = {
        dark: { color: '#1a1a1a', symbolColor: '#ffffff' },
        light: { color: '#ffffff', symbolColor: '#374151' }
    };

    const fallback = isDarkTheme ? titleBarColors.dark : titleBarColors.light;
    return getTitleBarOverlayColors(fallback);
}

/**
 * Base-theme canvas colour, for when no renderer has reported a real one yet
 * (first ever launch, or a window opened between a theme change and the
 * renderer applying it). These MUST track --nim-bg in NimbalystTheme.css.
 */
function fallbackBackgroundColor(theme: string): string {
    if (theme === 'crystal-dark') return '#0f172a';
    return isCurrentThemeDark(theme) ? '#2d2d2d' : '#ffffff';
}

/**
 * The colour to paint a window's canvas with before the renderer loads.
 *
 * Prefers the active theme's real --nim-bg as last reported by the renderer,
 * which is the only way main can know the colour of an extension or file-based
 * theme — those live in the renderer's theme registry, so resolving them here
 * would otherwise collapse to a base light/dark stand-in and open a light
 * extension theme on white.
 */
export function getBackgroundColor() {
    return getThemeBackgroundColor() ?? fallbackBackgroundColor(getTheme());
}
