/**
 * Central Window Fullscreen Listener
 *
 * Subscribes to `window-chrome:full-screen-changed` ONCE and mirrors the state
 * into `windowFullScreenAtom`. Also fetches the current value, since main only
 * pushes on transitions and a reload can land inside fullscreen.
 *
 * Call initWindowFullScreenListener() once at app startup.
 */

import { store } from '@nimbalyst/runtime/store';
import { WINDOW_FULL_SCREEN_CHANNELS } from '../../../shared/windowChrome';
import { windowFullScreenAtom } from '../atoms/windowFullScreen';

let initialized = false;

export function initWindowFullScreenListener(): () => void {
  if (initialized) {
    return () => {};
  }
  initialized = true;

  const unsubscribe = window.electronAPI?.on?.(
    WINDOW_FULL_SCREEN_CHANNELS.changed,
    (fullScreen: boolean) => {
      store.set(windowFullScreenAtom, fullScreen === true);
    },
  );

  void window.electronAPI?.getWindowFullScreen?.()
    .then((fullScreen) => {
      store.set(windowFullScreenAtom, fullScreen === true);
    })
    .catch(() => {
      // A window without the chrome handlers just never shows the control.
    });

  return () => {
    initialized = false;
    if (typeof unsubscribe === 'function') {
      unsubscribe();
    }
  };
}
