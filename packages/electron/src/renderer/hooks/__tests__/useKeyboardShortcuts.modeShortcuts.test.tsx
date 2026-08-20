// @vitest-environment jsdom
/**
 * The mode shortcuts double as pane toggles: pressing a mode's own chord while
 * that mode is already active collapses/expands its left pane instead of
 * re-selecting the mode. Cmd+T was the odd one out until it joined Cmd+E and
 * Cmd+K, and nothing on screen distinguishes "switched again" from "toggled".
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { useKeyboardShortcuts } from '../useKeyboardShortcuts';
import type { ContentMode } from '../../types/WindowModeTypes';

vi.mock('posthog-js', () => ({ default: { capture: vi.fn() } }));

const setActiveMode = vi.fn();
const toggleActiveLeftPane = vi.fn();
const exitFullscreenPanel = vi.fn();

function Harness({ activeMode, isFullscreenPanelActive = false, orgModeAvailable = true }: {
  activeMode: ContentMode;
  isFullscreenPanelActive?: boolean;
  orgModeAvailable?: boolean;
}): React.ReactElement {
  useKeyboardShortcuts({
    activeMode,
    workspaceMode: true,
    setActiveMode,
    activeModeStateRef: { current: activeMode },
    editorModeRef: { current: null },
    agentModeRef: { current: null },
    toggleAgentCollapsed: vi.fn(),
    toggleActiveLeftPane,
    openHistoryForCurrentDocument: vi.fn(),
    isFullscreenPanelActive,
    exitFullscreenPanel,
    orgModeAvailable,
  });
  return <div />;
}

/** Dispatch the app modifier + key, matching the hook's platform detection. */
function pressAppModifier(key: string, extra: KeyboardEventInit = {}): void {
  const isMac = navigator.platform.startsWith('Mac');
  window.dispatchEvent(new KeyboardEvent('keydown', {
    key,
    metaKey: isMac,
    ctrlKey: !isMac,
    bubbles: true,
    ...extra,
  }));
}

beforeEach(() => {
  setActiveMode.mockReset();
  toggleActiveLeftPane.mockReset();
  exitFullscreenPanel.mockReset();
});

describe('Cmd+T', () => {
  it('switches into Tracker mode from another mode', () => {
    render(<Harness activeMode="files" />);
    pressAppModifier('t');

    expect(setActiveMode).toHaveBeenCalledWith('tracker');
    expect(toggleActiveLeftPane).not.toHaveBeenCalled();
  });

  it('toggles the left pane instead of re-switching when already in Tracker mode', () => {
    render(<Harness activeMode="tracker" />);
    pressAppModifier('t');

    expect(toggleActiveLeftPane).toHaveBeenCalledTimes(1);
    expect(setActiveMode).not.toHaveBeenCalled();
  });

  it('surfaces Tracker mode rather than toggling an unseen pane behind a fullscreen panel', () => {
    render(<Harness activeMode="tracker" isFullscreenPanelActive />);
    pressAppModifier('t');

    expect(exitFullscreenPanel).toHaveBeenCalledTimes(1);
    expect(setActiveMode).toHaveBeenCalledWith('tracker');
    expect(toggleActiveLeftPane).not.toHaveBeenCalled();
  });
});

describe('Cmd+Alt+M', () => {
  // Option rewrites the character on macOS (Option+M is "µ"), so the chord is
  // matched on `code` as well — a `key`-only match silently never fires.
  it('switches into Org mode when the project has an organization', () => {
    render(<Harness activeMode="files" />);
    pressAppModifier('µ', { altKey: true, code: 'KeyM' });

    expect(setActiveMode).toHaveBeenCalledWith('org');
  });

  it('does nothing when the project has no organization', () => {
    render(<Harness activeMode="files" orgModeAvailable={false} />);
    pressAppModifier('m', { altKey: true, code: 'KeyM' });

    expect(setActiveMode).not.toHaveBeenCalled();
  });
});
