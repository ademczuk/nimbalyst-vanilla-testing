/**
 * Centralized IPC listener for the menu-bar sessions panel.
 *
 * The panel is its own renderer (`?mode=tray-panel`) with an empty session
 * registry, so its entire dataset arrives from the main process. Per
 * docs/IPC_LISTENERS.md the subscription lives here and `TrayPanelApp` reads the
 * atom.
 */

import { atom } from 'jotai';
import { store } from '../index';
import {
  TRAY_PANEL_CHANNELS,
  emptyTrayPanelFeed,
  type TrayPanelFeed,
} from '../../../shared/traySessions';

/** The three attention buckets, as last pushed by TrayManager. */
export const trayPanelFeedAtom = atom<TrayPanelFeed>(emptyTrayPanelFeed());

/**
 * Subscribe to feed pushes and pull the current feed once on start.
 *
 * Called from the tray panel window only; a project window has no panel to feed
 * and the main process ignores requests from any other sender.
 */
export function initTrayPanelListener(): () => void {
  const unsubscribe = window.electronAPI.on(
    TRAY_PANEL_CHANNELS.sessions,
    (feed: TrayPanelFeed) => {
      store.set(trayPanelFeedAtom, feed ?? emptyTrayPanelFeed());
    },
  );

  // The first push only lands on the next session state change, which may be
  // minutes away -- ask for the current cache so the panel paints immediately.
  void window.electronAPI
    .invoke(TRAY_PANEL_CHANNELS.requestSessions)
    .then((initial: TrayPanelFeed) => {
      if (initial) store.set(trayPanelFeedAtom, initial);
    });

  return () => unsubscribe?.();
}
