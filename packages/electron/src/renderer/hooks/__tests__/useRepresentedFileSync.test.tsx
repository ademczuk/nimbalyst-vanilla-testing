// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import React, { useRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TabsProvider, useTabsActions } from '../../contexts/TabsContext';
import { useRepresentedFileSync } from '../useRepresentedFileSync';

const setRepresentedFile = vi.fn();

beforeEach(() => {
  setRepresentedFile.mockClear();
  (globalThis as any).window.electronAPI = {
    setRepresentedFile,
    invoke: vi.fn().mockResolvedValue(undefined),
  };
});

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <TabsProvider workspacePath={null} disablePersistence>
      {children}
    </TabsProvider>
  );
}

/** Drives the tab store through the action-only hook, so the probe's own render count stays attributable to useRepresentedFileSync. */
function useProbe(isActive: boolean) {
  const renderCount = useRef(0);
  renderCount.current += 1;
  const actions = useTabsActions();
  useRepresentedFileSync(isActive);
  return { actions, renderCount };
}

describe('useRepresentedFileSync', () => {
  it('follows the active tab, and represents nothing for a non-filesystem tab', () => {
    const { result } = renderHook(useProbe, { wrapper, initialProps: true });

    act(() => {
      result.current.actions.addTab('/ws/notes.md');
    });
    expect(setRepresentedFile).toHaveBeenLastCalledWith('/ws/notes.md');

    act(() => {
      result.current.actions.addTab('tracker://item-42');
    });
    expect(setRepresentedFile).toHaveBeenLastCalledWith(null);
  });

  // The reason this hook subscribes in an effect instead of through useTabs():
  // its host drives tab visibility imperatively and must stay off the render
  // path when tabs change.
  it('does not re-render its host when tabs change', () => {
    const { result } = renderHook(useProbe, { wrapper, initialProps: true });
    const initialRenders = result.current.renderCount.current;

    let firstTabId: string | null = null;
    act(() => {
      firstTabId = result.current.actions.addTab('/ws/notes.md');
      result.current.actions.addTab('/ws/other.md');
    });
    act(() => result.current.actions.switchTab(firstTabId!));

    expect(setRepresentedFile).toHaveBeenLastCalledWith('/ws/notes.md');
    expect(result.current.renderCount.current).toBe(initialRenders);
  });

  it('stops representing its tabs once it goes inactive', () => {
    const { result, rerender } = renderHook(useProbe, { wrapper, initialProps: true });

    act(() => {
      result.current.actions.addTab('/ws/notes.md');
    });
    setRepresentedFile.mockClear();

    rerender(false);
    act(() => {
      result.current.actions.addTab('/ws/other.md');
    });

    expect(setRepresentedFile).not.toHaveBeenCalled();
  });
});
