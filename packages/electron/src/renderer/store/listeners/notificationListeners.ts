/**
 * Central Notification Listener
 *
 * Subscribes to `notifications:check-active-session` ONCE. The main process
 * uses this to ask "is the user currently viewing this session?" so it can
 * suppress OS notifications. We answer by reading activeSessionIdAtom from
 * the store and sending the response back.
 *
 * Call initNotificationListeners() once at app startup.
 */

import { store } from '@nimbalyst/runtime/store';
import { activeSessionIdAtom } from '../atoms/sessions';
import { notificationSettingsAtom } from '../atoms/appSettings';

let initialized = false;

export function initNotificationListeners(): () => void {
  if (initialized) {
    return () => {};
  }
  initialized = true;

  const unsubscribe = window.electronAPI?.on?.(
    'notifications:check-active-session',
    (data: { requestId: string; sessionId: string }) => {
      const activeSessionId = store.get(activeSessionIdAtom);
      const isViewing = activeSessionId === data.sessionId;
      // Main process uses ipcMain.once for the response, so use send.
      window.electronAPI?.send?.(
        `notifications:session-check-response:${data.requestId}`,
        isViewing,
      );
    },
  );

  /*
   * The menu bar island can turn notifications off from outside any window.
   *
   * Not merely a stale checkbox if this is missed: the Notifications settings
   * panel rewrites the *whole* notification block on any edit, so a window that
   * never heard about the island's change would put the old value straight back
   * the next time the user touched the completion sound. Written straight into
   * the atom rather than through the setter, which would persist it again.
   */
  const unsubscribeEnabled = window.electronAPI?.on?.(
    'notifications:enabled-changed',
    (enabled: boolean) => {
      const current = store.get(notificationSettingsAtom);
      if (current.osNotificationsEnabled === enabled) return;
      store.set(notificationSettingsAtom, { ...current, osNotificationsEnabled: enabled });
    },
  );

  return () => {
    initialized = false;
    if (typeof unsubscribe === 'function') {
      unsubscribe();
    }
    if (typeof unsubscribeEnabled === 'function') {
      unsubscribeEnabled();
    }
  };
}
