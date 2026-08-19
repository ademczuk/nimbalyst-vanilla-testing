import { BrowserWindow } from 'electron';
import { safeHandle, safeOn } from '../utils/ipcRegistry';
import { setResolvedTitleBarOverlayColors } from '../window/windowChrome';
import { getWindowMenuBar, invokeWindowMenuItem } from '../menu/menuBarBridge';
import { WINDOW_MENU_CHANNELS } from '../../shared/menuBar';
import { WINDOW_FULL_SCREEN_CHANNELS } from '../../shared/windowChrome';

let handlersRegistered = false;

export function registerWindowChromeHandlers(): void {
  if (handlersRegistered) return;

  safeOn('window-chrome:set-overlay-colors', (_event, payload: unknown) => {
    setResolvedTitleBarOverlayColors(payload);
  });

  safeHandle(WINDOW_MENU_CHANNELS.get, () => getWindowMenuBar());

  safeHandle(WINDOW_MENU_CHANNELS.invoke, (event, id: unknown, revision: unknown) => {
    if (typeof id !== 'string' || typeof revision !== 'number') {
      return { invoked: false };
    }
    return invokeWindowMenuItem(id, revision, BrowserWindow.fromWebContents(event.sender));
  });

  safeHandle(WINDOW_FULL_SCREEN_CHANNELS.get, (event) =>
    BrowserWindow.fromWebContents(event.sender)?.isFullScreen() ?? false);

  safeOn(WINDOW_FULL_SCREEN_CHANNELS.exit, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window && !window.isDestroyed()) {
      window.setFullScreen(false);
    }
  });

  handlersRegistered = true;
}
