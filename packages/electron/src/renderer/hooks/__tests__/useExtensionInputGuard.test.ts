import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const originalAdd = window.addEventListener;
const originalRemove = window.removeEventListener;

beforeAll(async () => {
  await import('../useExtensionInputGuard');
});

afterAll(() => {
  window.addEventListener = originalAdd;
  window.removeEventListener = originalRemove;
});

const key = (type: string, options: KeyboardEventInit = {}) =>
  window.dispatchEvent(new KeyboardEvent(type, { key: 'Escape', ...options }));

describe('extension keyboard listener cleanup', () => {
  it('removes one callback registered for multiple keyboard events, as the file tree does', () => {
    const handler = vi.fn();
    window.addEventListener('keydown', handler);
    window.addEventListener('keyup', handler);
    key('keydown');
    key('keyup');
    expect(handler).toHaveBeenCalledTimes(2);

    window.removeEventListener('keydown', handler);
    window.removeEventListener('keyup', handler);
    handler.mockClear();
    key('keydown');
    key('keyup');
    expect(handler).not.toHaveBeenCalled();
  });

  it('preserves native duplicate-registration and capture matching', () => {
    const handler = vi.fn();
    window.addEventListener('keydown', handler);
    window.addEventListener('keydown', handler);
    window.addEventListener('keydown', handler, true);
    key('keydown');
    expect(handler).toHaveBeenCalledTimes(2);

    window.removeEventListener('keydown', handler);
    handler.mockClear();
    key('keydown');
    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener('keydown', handler, true);
    handler.mockClear();
    key('keydown');
    expect(handler).not.toHaveBeenCalled();
  });

  it('keeps once and abort behavior when a callback is registered again', () => {
    const handler = vi.fn();
    window.addEventListener('keydown', handler, { once: true });
    key('keydown');
    key('keydown');
    expect(handler).toHaveBeenCalledTimes(1);
    const controller = new AbortController();
    window.addEventListener('keydown', handler, { signal: controller.signal });
    key('keydown');
    controller.abort();
    key('keydown');
    expect(handler).toHaveBeenCalledTimes(2);
    window.addEventListener('keydown', handler);
    key('keydown');
    window.removeEventListener('keydown', handler);
    key('keydown');
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it('guards typing while preserving navigation, shortcuts, and listener objects', () => {
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    const listener = { handleEvent: vi.fn() };
    window.addEventListener('keydown', listener);
    try {
      key('keydown', { key: 'a' });
      expect(listener.handleEvent).not.toHaveBeenCalled();
      key('keydown');
      key('keydown', { key: 'a', ctrlKey: true });
      expect(listener.handleEvent).toHaveBeenCalledTimes(2);
      expect(listener.handleEvent.mock.instances).toEqual([listener, listener]);
    } finally {
      window.removeEventListener('keydown', listener);
      input.remove();
    }
  });
});
