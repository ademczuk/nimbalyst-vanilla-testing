/**
 * `onWorkspaceEvent` is the only path an extension panel has to host events, and
 * its filter decides what the Git panel ever hears about.
 *
 * Git watchers are registered PER REPOSITORY, so in a multi-root workspace they
 * name a repo inside an attached folder -- never the primary root. A filter that
 * compares against the primary root alone drops every one of those events, and
 * the panel silently stops refreshing for the attached repo. The Git panel's own
 * tests substitute the host subscription, so only this level can catch it.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';

const listeners = new Map<string, Array<(data: unknown) => void>>();
const roots: string[] = [];

vi.mock('@nimbalyst/runtime/store', () => ({
  store: { get: () => roots },
}));
vi.mock('../ExtensionFileStorageImpl', () => ({
  ExtensionFileStorageImpl: class {},
}));

const { createPanelHost } = await import('../PanelHostImpl');

function emit(event: string, data: unknown): void {
  for (const listener of listeners.get(event) ?? []) listener(data);
}

function makeHost(workspacePath: string) {
  return createPanelHost({
    panelId: 'git',
    extensionId: 'nimbalyst.git',
    theme: 'dark',
    workspacePath,
    storage: { get: () => undefined, set: async () => {} } as never,
    onOpenFile: () => {},
    onOpenPanel: () => {},
    onClose: () => {},
    onThemeChange: () => () => {},
  } as never);
}

beforeEach(() => {
  listeners.clear();
  roots.length = 0;
  (globalThis as never as { window: unknown }).window = {
    electronAPI: {
      on: (event: string, callback: (data: unknown) => void) => {
        const forEvent = listeners.get(event) ?? [];
        forEvent.push(callback);
        listeners.set(event, forEvent);
        return () => {};
      },
    },
  };
});

describe('PanelHostImpl.onWorkspaceEvent', () => {
  it('delivers an event naming a repo inside an attached folder', () => {
    roots.push('/repo', '/other/infra');
    const received: unknown[] = [];
    makeHost('/repo').onWorkspaceEvent('git:status-changed', (data) => received.push(data));

    emit('git:status-changed', { workspacePath: '/other/infra/terraform' });

    expect(received).toEqual([{ workspacePath: '/other/infra/terraform' }]);
  });

  it('still drops an event from an unrelated workspace', () => {
    roots.push('/repo', '/other/infra');
    const received: unknown[] = [];
    makeHost('/repo').onWorkspaceEvent('git:status-changed', (data) => received.push(data));

    emit('git:status-changed', { workspacePath: '/somewhere/else' });
    // A sibling directory sharing a prefix is not inside the root.
    emit('git:status-changed', { workspacePath: '/repo-other' });

    expect(received).toEqual([]);
  });

  it('delivers an event with no workspacePath at all', () => {
    roots.push('/repo');
    const received: unknown[] = [];
    makeHost('/repo').onWorkspaceEvent('extension:message', (data) => received.push(data));

    emit('extension:message', { kind: 'ping' });

    expect(received).toEqual([{ kind: 'ping' }]);
  });
});
