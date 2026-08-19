// @vitest-environment node
/**
 * y-monaco repaints remote cursors synchronously from the awareness `change`
 * event, which it triggers from Monaco's cursor-selection event -- so the
 * repaint's `deltaDecorations` can re-enter a decoration change Monaco already
 * has open, and Monaco reports that through `onUnexpectedError`. The binding
 * defers `change` listeners to a microtask to stay out of that window.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const captured = vi.hoisted(() => ({ awareness: null as any, destroy: vi.fn() }));

vi.mock('y-monaco', () => ({
  MonacoBinding: class {
    constructor(_yText: unknown, _model: unknown, _editors: unknown, awareness: unknown) {
      captured.awareness = awareness;
    }
    destroy() {
      captured.destroy();
    }
  },
}));

const { createMonacoCollabBinding } = await import('../monacoCollabBinding');

/** Awareness stand-in with the synchronous emit that causes the re-entrancy. */
function createFakeAwareness() {
  const listeners = new Map<string, Array<(...args: any[]) => void>>();
  return {
    states: new Map([[1, { selection: null }]]),
    getStates() {
      return this.states;
    },
    on(event: string, listener: (...args: any[]) => void) {
      (listeners.get(event) ?? listeners.set(event, []).get(event)!).push(listener);
    },
    off(event: string, listener: (...args: any[]) => void) {
      const forEvent = listeners.get(event) ?? [];
      const index = forEvent.indexOf(listener);
      if (index >= 0) forEvent.splice(index, 1);
    },
    setLocalStateField() {
      (listeners.get('change') ?? []).forEach((listener) => listener({ added: [], updated: [1], removed: [] }));
    },
  };
}

function createFakeEditor() {
  return { getModel: () => ({ id: 'model-1' }) } as any;
}

describe('createMonacoCollabBinding', () => {
  beforeEach(() => {
    captured.awareness = null;
    captured.destroy.mockClear();
  });

  it('defers awareness change listeners out of the synchronous selection path', async () => {
    const awareness = createFakeAwareness();
    createMonacoCollabBinding({ yText: {} as any, editor: createFakeEditor(), awareness: awareness as any });

    const repaint = vi.fn();
    captured.awareness.on('change', repaint);
    captured.awareness.setLocalStateField('selection', {});

    expect(repaint).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(repaint).toHaveBeenCalledTimes(1);
  });

  it('passes non-change members through to the real awareness', () => {
    const awareness = createFakeAwareness();
    createMonacoCollabBinding({ yText: {} as any, editor: createFakeEditor(), awareness: awareness as any });

    expect(captured.awareness.getStates()).toBe(awareness.states);

    const other = vi.fn();
    captured.awareness.on('update', other);
    // `off` must reach the same registration the wrapper made for `change`.
    const repaint = vi.fn();
    captured.awareness.on('change', repaint);
    captured.awareness.off('change', repaint);
    captured.awareness.setLocalStateField('selection', {});
    expect(repaint).not.toHaveBeenCalled();
  });

  it('drops a queued repaint when the binding is destroyed first', async () => {
    const awareness = createFakeAwareness();
    const handle = createMonacoCollabBinding({
      yText: {} as any,
      editor: createFakeEditor(),
      awareness: awareness as any,
    });

    const repaint = vi.fn();
    captured.awareness.on('change', repaint);
    captured.awareness.setLocalStateField('selection', {});
    handle.destroy();

    await Promise.resolve();
    expect(repaint).not.toHaveBeenCalled();
    expect(captured.destroy).toHaveBeenCalled();
  });
});
