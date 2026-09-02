import { afterEach, describe, expect, it, vi } from 'vitest';
import { store } from '@nimbalyst/runtime/store';
import { markSessionsReadAtom, sessionUnreadAtom } from '../sessions';

describe('markSessionsReadAtom', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('clears unread for every session once, even when an id repeats', () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('window', { electronAPI: { invoke } });

    const parent = 'mark-all-read-parent';
    const children = ['mark-all-read-child-1', 'mark-all-read-child-2'];
    for (const id of [parent, ...children]) {
      store.set(sessionUnreadAtom(id), true);
    }

    store.set(markSessionsReadAtom, [parent, ...children, parent]);

    for (const id of [parent, ...children]) {
      expect(store.get(sessionUnreadAtom(id))).toBe(false);
    }
    const persisted = invoke.mock.calls
      .filter(([channel]) => channel === 'ai:updateSessionMetadata')
      .map(([, sessionId]) => sessionId);
    expect(persisted).toEqual([parent, ...children]);
  });
});
