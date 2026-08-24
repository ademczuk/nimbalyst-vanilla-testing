// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '@nimbalyst/runtime/store';
import { githubIssueListUpdatedAtom } from '../../atoms/githubIssues';
import { initGithubIssueListeners } from '../githubIssueListeners';

describe('githubIssueListeners', () => {
  let callback: ((payload: { workspacePath: string; remote: string }) => void) | null = null;
  let cleanup: (() => void) | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    store.set(githubIssueListUpdatedAtom, null);
    vi.stubGlobal('window', {
      electronAPI: {
        on: vi.fn((_channel: string, handler: typeof callback) => {
          callback = handler;
          return vi.fn();
        }),
      },
    });
    cleanup = initGithubIssueListeners();
  });

  afterEach(() => {
    cleanup?.();
    callback = null;
    cleanup = null;
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('coalesces rapid broadcasts and publishes the latest workspace payload once', async () => {
    callback?.({ workspacePath: '/first', remote: 'owner/first' });
    callback?.({ workspacePath: '/second', remote: 'owner/second' });

    await vi.advanceTimersByTimeAsync(149);
    expect(store.get(githubIssueListUpdatedAtom)).toBeNull();

    await vi.advanceTimersByTimeAsync(1);
    expect(store.get(githubIssueListUpdatedAtom)).toEqual({
      version: 1,
      payload: { workspacePath: '/second', remote: 'owner/second' },
    });
  });
});
