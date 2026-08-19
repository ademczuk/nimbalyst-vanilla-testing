import { existsSync } from 'fs';
import { join } from 'path';
import { app, nativeImage } from 'electron';
import { logger } from './logger';

/**
 * Apply the Nimbalyst Dock icon (macOS).
 *
 * In dev the app runs out of `Electron.app`, so the Dock and app-switcher icon
 * is whatever this sets at runtime — without it you get the stock Electron
 * icon. That makes it fragile: macOS rebuilds the Dock tile whenever the app's
 * activation policy is set, discarding the runtime icon, so anything that calls
 * `app.setActivationPolicy` has to call this again afterwards.
 *
 * Callers: startup, and tray panel creation (see TrayPanelWindow).
 */
export function applyDockIcon(): void {
  if (process.platform !== 'darwin' || !app.dock) return;

  // icon.png is at the package root in both dev and packaged builds (included
  // in electron-builder's `files` array, so it's inside the ASAR at the root).
  const iconPath = join(app.getAppPath(), 'icon.png');
  if (!existsSync(iconPath)) {
    logger.main.warn(`icon not found at: ${iconPath}`);
    return;
  }

  app.dock.setIcon(nativeImage.createFromPath(iconPath));
}
