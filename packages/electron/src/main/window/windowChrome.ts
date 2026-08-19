import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';
import {
  MAIN_WINDOW_TITLE_BAR_HEIGHT,
  WINDOW_FULL_SCREEN_CHANNELS,
  isTitleBarOverlayColors,
  type TitleBarOverlayColors,
} from '../../shared/windowChrome';

/** Centres the traffic lights in the 38px custom title bar on macOS. */
export const MAC_TRAFFIC_LIGHT_POSITION = { x: 10, y: 12 } as const;

export interface CustomTitleBarOptionsInput {
  platform: NodeJS.Platform;
  overlayColors: TitleBarOverlayColors;
}

export interface WindowTitleBarOptionsInput extends CustomTitleBarOptionsInput {
  customTitleBar: boolean;
}

type OverlayWindow = Pick<BrowserWindow, 'id' | 'isDestroyed' | 'once' | 'setTitleBarOverlay'>;

interface RegisteredOverlayWindow {
  platform: NodeJS.Platform;
  window: OverlayWindow;
}

const overlayWindows = new Map<number, RegisteredOverlayWindow>();
let resolvedOverlayColors: TitleBarOverlayColors | null = null;

export function customTitleBarOptions(
  input: CustomTitleBarOptionsInput,
): Partial<BrowserWindowConstructorOptions> {
  if (input.platform === 'darwin') {
    return {
      titleBarStyle: 'hiddenInset',
      titleBarOverlay: true,
      trafficLightPosition: { ...MAC_TRAFFIC_LIGHT_POSITION },
    };
  }

  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      ...input.overlayColors,
      height: MAIN_WINDOW_TITLE_BAR_HEIGHT,
    },
    autoHideMenuBar: true,
  };
}

/**
 * Opt a macOS `hiddenInset` window into the Window Controls Overlay API.
 *
 * This has no visual effect — the traffic lights are drawn either way. It
 * exists so the renderer can read the region they occupy via
 * `navigator.windowControlsOverlay.getTitlebarAreaRect()` and keep floating
 * menus out from under them (GitHub #1096). Without it the API reports
 * nothing and `windowControlsClearance()` is inert in that window.
 */
export function windowControlsOverlayOptions(
  platform: NodeJS.Platform = process.platform,
): Partial<BrowserWindowConstructorOptions> {
  return platform === 'darwin' ? { titleBarOverlay: true } : {};
}

export function titleBarOptionsForWindow(
  input: WindowTitleBarOptionsInput,
): Partial<BrowserWindowConstructorOptions> {
  if (!input.customTitleBar) return {};
  return customTitleBarOptions(input);
}

function applyOverlayColors(
  registered: RegisteredOverlayWindow,
  colors: TitleBarOverlayColors,
): void {
  const { platform, window } = registered;
  if (window.isDestroyed() || typeof window.setTitleBarOverlay !== 'function') return;

  try {
    window.setTitleBarOverlay(
      platform === 'darwin'
        ? colors
        : { ...colors, height: MAIN_WINDOW_TITLE_BAR_HEIGHT },
    );
  } catch (error) {
    console.error('[WindowChrome] Failed to update title-bar overlay:', error);
  }
}

function applyColorsToRegisteredWindows(colors: TitleBarOverlayColors): void {
  for (const registered of overlayWindows.values()) {
    applyOverlayColors(registered, colors);
  }
}

export function registerCustomTitleBarWindow(
  window: OverlayWindow,
  platform: NodeJS.Platform = process.platform,
): void {
  overlayWindows.set(window.id, { platform, window });
  window.once('closed', () => {
    overlayWindows.delete(window.id);
  });
}

interface FullScreenWindow {
  isDestroyed(): boolean;
  on(event: 'enter-full-screen' | 'leave-full-screen', listener: () => void): unknown;
  setWindowButtonPosition?(position: { x: number; y: number } | null): void;
  webContents: Pick<BrowserWindow['webContents'], 'send'>;
}

/**
 * Keep a custom-title-bar window escapable in fullscreen.
 *
 * Two things happen on the way in. On macOS the custom `trafficLightPosition`
 * pulls the buttons out of the standard title-bar accessory, which is the thing
 * the OS slides down when the cursor hits the top edge in fullscreen — so the
 * lights never come back and the green button is unreachable. Handing
 * positioning back to the OS (`null`) restores that reveal, and the custom
 * offset goes back on the way out.
 *
 * Either way the renderer is told, so the title bar can draw its own exit
 * control where the window controls used to sit (GitHub #1310 covers persisting
 * the state itself).
 */
export function registerFullScreenChrome(
  window: FullScreenWindow,
  platform: NodeJS.Platform = process.platform,
): void {
  const applyFullScreen = (fullScreen: boolean): void => {
    if (window.isDestroyed()) return;

    if (platform === 'darwin' && typeof window.setWindowButtonPosition === 'function') {
      window.setWindowButtonPosition(fullScreen ? null : { ...MAC_TRAFFIC_LIGHT_POSITION });
    }

    try {
      window.webContents.send(WINDOW_FULL_SCREEN_CHANNELS.changed, fullScreen);
    } catch (error) {
      console.error('[WindowChrome] Failed to push fullscreen state:', error);
    }
  };

  window.on('enter-full-screen', () => applyFullScreen(true));
  window.on('leave-full-screen', () => applyFullScreen(false));
}

export function getTitleBarOverlayColors(
  fallback: TitleBarOverlayColors,
): TitleBarOverlayColors {
  return resolvedOverlayColors ?? fallback;
}

export function setResolvedTitleBarOverlayColors(payload: unknown): boolean {
  if (!isTitleBarOverlayColors(payload)) return false;
  resolvedOverlayColors = {
    color: payload.color.trim(),
    symbolColor: payload.symbolColor.trim(),
  };
  applyColorsToRegisteredWindows(resolvedOverlayColors);
  return true;
}

export function resetTitleBarOverlayColors(fallback: TitleBarOverlayColors): void {
  resolvedOverlayColors = null;
  applyColorsToRegisteredWindows(fallback);
}

export function resetWindowChromeStateForTests(): void {
  resolvedOverlayColors = null;
  overlayWindows.clear();
}
