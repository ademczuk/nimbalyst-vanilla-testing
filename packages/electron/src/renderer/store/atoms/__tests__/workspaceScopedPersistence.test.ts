import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '@nimbalyst/runtime/store';
import {
  initSessionEditors,
  setSessionSplitRatioAtom,
} from '../sessionEditors';
import {
  initWorkstreamState,
  workstreamStateAtom,
} from '../workstreamState';

describe('workspace-scoped debounced persistence', () => {
  const invoke = vi.fn(async (channel: string) => {
    if (channel === 'workspace:get-state') return {};
    return true;
  });

  beforeEach(() => {
    vi.useFakeTimers();
    invoke.mockClear();
    vi.stubGlobal('window', { electronAPI: { invoke } });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keeps a pending workstream write bound to the workspace that scheduled it', async () => {
    initWorkstreamState('/workspace-a');
    store.set(workstreamStateAtom('workstream-a'), { splitRatio: 0.7 });

    initWorkstreamState('/workspace-b');
    await vi.advanceTimersByTimeAsync(500);

    // Sends only this workstream's entry -- reading the whole workspace state
    // back to merge it made each persist a multi-megabyte round trip.
    expect(invoke).toHaveBeenCalledWith(
      'workspace:set-workstream-state',
      expect.objectContaining({
        workspacePath: '/workspace-a',
        workstreamId: 'workstream-a',
        state: expect.objectContaining({ splitRatio: 0.7 }),
      }),
    );
    expect(invoke).not.toHaveBeenCalledWith('workspace:get-state', expect.anything());
    expect(invoke).not.toHaveBeenCalledWith(
      'workspace:set-workstream-state',
      expect.objectContaining({ workspacePath: '/workspace-b' }),
    );
  });

  it('keeps a pending session-editor write bound to the workspace that scheduled it', async () => {
    initSessionEditors('/workspace-a');
    store.set(setSessionSplitRatioAtom, { sessionId: 'session-a', ratio: 0.7 });

    initSessionEditors('/workspace-b');
    await vi.advanceTimersByTimeAsync(500);

    expect(invoke).toHaveBeenCalledWith('workspace:get-state', '/workspace-a');
    expect(invoke).toHaveBeenCalledWith(
      'workspace:update-state',
      '/workspace-a',
      expect.objectContaining({ sessionEditorStates: expect.any(Object) }),
    );
    expect(invoke).not.toHaveBeenCalledWith(
      'workspace:update-state',
      '/workspace-b',
      expect.anything(),
    );
  });
});
