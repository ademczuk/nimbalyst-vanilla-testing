// @vitest-environment node
/**
 * Attached folders are the persisted definition of a multi-root workspace, and
 * every consumer (explorer forest, watcher set, search fan-out, agent
 * `additionalDirectories`) derives its root list from them. These cases pin the
 * invariants those consumers rely on: the primary root is never an attachment,
 * the list never contains duplicates, and a list persisted by a build with a
 * different cap is preserved rather than truncated.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';

let backing: Record<string, unknown> = {};

vi.mock('electron-store', () => {
  class FakeStore {
    path = '/mock/path/workspace-settings.json';
    get store() {
      return JSON.parse(JSON.stringify(backing));
    }
    get(key: string) {
      return JSON.parse(JSON.stringify(backing))[key];
    }
    set(key: string, value: unknown) {
      backing[key] = JSON.parse(JSON.stringify(value));
    }
    delete(key: string) {
      delete backing[key];
    }
  }
  return { default: FakeStore };
});

const PRIMARY = '/tmp/multi-root-primary';
const ATTACHED = '/tmp/multi-root-attached';

/** Mirrors `workspaceKey` in the store so fixtures can seed persisted state. */
function keyFor(workspacePath: string): string {
  return `ws:${Buffer.from(workspacePath).toString('base64url')}`;
}

async function loadStore() {
  const store = await import('../store');
  store.invalidateWorkspaceStoreCache();
  return store;
}

describe('attached folders', () => {
  beforeEach(() => {
    backing = {};
  });

  it('defaults to no attachments and a single root', async () => {
    const { getAttachedFolders, getWorkspaceRoots } = await loadStore();

    expect(getAttachedFolders(PRIMARY)).toEqual([]);
    expect(getWorkspaceRoots(PRIMARY)).toEqual([PRIMARY]);
  });

  it('attaches a folder and orders roots primary-first', async () => {
    const { attachFolderToWorkspace, getWorkspaceRoots } = await loadStore();

    expect(attachFolderToWorkspace(PRIMARY, ATTACHED)).toEqual({
      ok: true,
      attachedFolders: [ATTACHED],
    });
    expect(getWorkspaceRoots(PRIMARY)).toEqual([PRIMARY, ATTACHED]);
  });

  it('rejects the primary root and duplicates instead of double-attaching', async () => {
    const { attachFolderToWorkspace, getAttachedFolders } = await loadStore();

    attachFolderToWorkspace(PRIMARY, ATTACHED);

    // Trailing slashes must normalize to the same root, or the explorer shows
    // the same folder twice and two watchers race on the same tree.
    expect(attachFolderToWorkspace(PRIMARY, `${ATTACHED}/`).ok).toBe(false);
    expect(attachFolderToWorkspace(PRIMARY, `${PRIMARY}/`)).toMatchObject({
      ok: false,
      reason: 'is-primary-root',
    });
    expect(getAttachedFolders(PRIMARY)).toEqual([ATTACHED]);
  });

  it('stops attaching at the soft cap', async () => {
    const { attachFolderToWorkspace, getAttachedFolders, MAX_ATTACHED_FOLDERS } = await loadStore();

    for (let i = 0; i < MAX_ATTACHED_FOLDERS; i++) {
      expect(attachFolderToWorkspace(PRIMARY, `/tmp/root-${i}`).ok).toBe(true);
    }

    expect(attachFolderToWorkspace(PRIMARY, '/tmp/root-overflow')).toMatchObject({
      ok: false,
      reason: 'cap-reached',
    });
    expect(getAttachedFolders(PRIMARY)).toHaveLength(MAX_ATTACHED_FOLDERS);
  });

  it('detaches without disturbing the other roots', async () => {
    const { attachFolderToWorkspace, detachFolderFromWorkspace, getWorkspaceRoots } = await loadStore();

    attachFolderToWorkspace(PRIMARY, ATTACHED);
    attachFolderToWorkspace(PRIMARY, '/tmp/multi-root-other');

    expect(detachFolderFromWorkspace(PRIMARY, `${ATTACHED}/`)).toEqual(['/tmp/multi-root-other']);
    expect(getWorkspaceRoots(PRIMARY)).toEqual([PRIMARY, '/tmp/multi-root-other']);
  });

  it('preserves a persisted list longer than the current cap', async () => {
    const overCap = Array.from({ length: 12 }, (_, i) => `/tmp/persisted-${i}`);
    backing[keyFor(PRIMARY)] = { workspacePath: PRIMARY, attachedFolders: overCap };

    const { getAttachedFolders } = await loadStore();

    expect(getAttachedFolders(PRIMARY)).toEqual(overCap);
  });

  it('drops malformed and self-referential entries from persisted state', async () => {
    backing[keyFor(PRIMARY)] = {
      workspacePath: PRIMARY,
      attachedFolders: [ATTACHED, '', ATTACHED, PRIMARY, 42, null],
    };

    const { getAttachedFolders } = await loadStore();

    expect(getAttachedFolders(PRIMARY)).toEqual([ATTACHED]);
  });
});
