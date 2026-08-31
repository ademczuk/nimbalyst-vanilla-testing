import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The island can turn OS notifications off from outside any project window.
 *
 * Worth a test because the damage is invisible from either side: the
 * Notifications settings panel rewrites the *whole* notification block on any
 * edit, so a window that never hears about the island's change silently puts
 * the old value back the next time the user touches an unrelated toggle there.
 */

const listeners = new Map<string, (payload: unknown) => void>();

beforeEach(() => {
  listeners.clear();
  vi.resetModules();
  (globalThis as unknown as { window: unknown }).window = {
    electronAPI: {
      on: vi.fn((channel: string, handler: (payload: unknown) => void) => {
        listeners.set(channel, handler);
        return () => listeners.delete(channel);
      }),
      send: vi.fn(),
    },
  };
});

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe('notificationListeners', () => {
  it('applies an out-of-window notifications change without re-persisting it', async () => {
    const { store } = await import('@nimbalyst/runtime/store');
    const { notificationSettingsAtom } = await import('../../atoms/appSettings');
    const { initNotificationListeners } = await import('../notificationListeners');

    store.set(notificationSettingsAtom, {
      ...store.get(notificationSettingsAtom),
      osNotificationsEnabled: true,
      completionSoundEnabled: true,
    });

    const dispose = initNotificationListeners();
    listeners.get('notifications:enabled-changed')?.(false);

    const next = store.get(notificationSettingsAtom);
    expect(next.osNotificationsEnabled).toBe(false);
    // Everything else survives: this is a patch, not a reload.
    expect(next.completionSoundEnabled).toBe(true);
    // Written straight into the atom. Going through the setter would schedule a
    // write back to main, which is the change we just received.
    expect((globalThis as any).window.electronAPI.send).not.toHaveBeenCalled();

    dispose();
  });
});
