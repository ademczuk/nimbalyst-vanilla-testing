import { describe, expect, it } from 'vitest';
import { createRef } from 'react';
import { renderHook } from '@testing-library/react';
import { keydownOriginatedInGrid, useGridKeyOriginGuard } from '../grid/gridKeyOrigin';

/**
 * The regression: RevoGrid's key handler is bound to `document`, so a keystroke
 * typed into a dialog elsewhere in the app reached the grid and opened the cell
 * editor over the selected row, overwriting its title.
 */
describe('keydownOriginatedInGrid', () => {
  const build = () => {
    const container = document.createElement('div');
    const cell = document.createElement('input');
    container.appendChild(cell);
    const outside = document.createElement('textarea');
    document.body.append(container, outside);
    return { container, cell, outside };
  };

  const keydownFrom = (target: EventTarget): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { key: 'x', bubbles: true, composed: true });
    Object.defineProperty(event, 'target', { value: target });
    return event;
  };

  it('places an event by composedPath when it is available', () => {
    const { container, cell, outside } = build();

    // Simulates dispatch-time composedPath, which crosses shadow boundaries and
    // is what actually runs in the browser.
    const withPath = (path: EventTarget[]) =>
      Object.assign(new KeyboardEvent('keydown', { key: 'x' }), {
        composedPath: () => path,
      }) as unknown as KeyboardEvent;

    expect(keydownOriginatedInGrid(container, withPath([cell, container, document]))).toBe(true);
    expect(keydownOriginatedInGrid(container, withPath([outside, document.body, document]))).toBe(false);
  });

  it('falls back to containment when the path is empty', () => {
    const { container, cell, outside } = build();

    expect(keydownOriginatedInGrid(container, keydownFrom(cell))).toBe(true);
    expect(keydownOriginatedInGrid(container, keydownFrom(outside))).toBe(false);
  });

  it('treats an unplaceable event as in-grid so arrow navigation still works', () => {
    const { container } = build();

    expect(keydownOriginatedInGrid(container, null)).toBe(true);
    expect(keydownOriginatedInGrid(container, keydownFrom(window))).toBe(true);
  });

  describe('useGridKeyOriginGuard', () => {
    /** The shape RevoGrid emits: bubbling, cancelable, carrying the real keydown. */
    const beforeKeyDown = (originTarget: EventTarget) =>
      new CustomEvent('beforekeydown', {
        bubbles: true,
        cancelable: true,
        composed: true,
        detail: { original: keydownFrom(originTarget) },
      });

    it('cancels the grid handler for outside keys and leaves inside keys alone', () => {
      const { container, cell, outside } = build();
      const ref = createRef<HTMLElement>() as { current: HTMLElement | null };
      ref.current = container;
      const { unmount } = renderHook(() => useGridKeyOriginGuard(ref));

      const fromOutside = beforeKeyDown(outside);
      cell.dispatchEvent(fromOutside);
      expect(fromOutside.defaultPrevented).toBe(true);

      const fromInside = beforeKeyDown(cell);
      cell.dispatchEvent(fromInside);
      expect(fromInside.defaultPrevented).toBe(false);

      unmount();
      const afterUnmount = beforeKeyDown(outside);
      cell.dispatchEvent(afterUnmount);
      expect(afterUnmount.defaultPrevented).toBe(false);
    });
  });
});
