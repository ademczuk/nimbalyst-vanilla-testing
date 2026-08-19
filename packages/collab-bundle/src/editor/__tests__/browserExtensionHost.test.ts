// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { Doc } from 'yjs';
import { Awareness } from 'y-protocols/awareness';

import {
  BROWSER_EDITOR_CAPABILITY_GAPS,
  BROWSER_EDITOR_SUPPORTED_CAPABILITIES,
  BrowserEditorCapabilityError,
  createBrowserEditorCapabilities,
  resolveBrowserFilesystemPermission,
} from '../browserEditorCapabilities';
import {
  createBrowserCollaborationContext,
  createBrowserExtensionEditorHost,
  flushBrowserCollaborativeContent,
} from '../browserExtensionHost';

function collaborationContext(overrides: Partial<{
  flushWithAck: (timeoutMs?: number) => Promise<boolean>;
}> = {}) {
  const yDoc = new Doc();
  return createBrowserCollaborationContext({
    yDoc,
    awareness: new Awareness(yDoc),
    user: { id: 'member-1', name: 'Ada', color: '#3A8FD6' },
    getStatus: () => 'connected',
    onStatusChange: () => () => {},
    loadInitialContent: async () => 'a,b\n1,2\n',
    flushWithAck: overrides.flushWithAck ?? (async () => true),
  });
}

function host(options: Parameters<typeof createBrowserExtensionEditorHost>[0] extends infer T
  ? Partial<Omit<T, 'filePath' | 'fileName' | 'collaboration'>>
  : never = {}) {
  return createBrowserExtensionEditorHost({
    filePath: 'collab://doc-1/budget.csv',
    fileName: 'budget.csv',
    collaboration: collaborationContext(),
    ...options,
  });
}

describe('browser editor capabilities', () => {
  it('never claims a capability it also lists as a gap', () => {
    const capabilities = createBrowserEditorCapabilities({
      history: true,
      menuItems: true,
      aiContext: true,
      binaryContent: true,
      externalLinks: true,
    });
    for (const capability of BROWSER_EDITOR_SUPPORTED_CAPABILITIES) {
      expect(capabilities.supports(capability)).toBe(true);
    }
    for (const gap of BROWSER_EDITOR_CAPABILITY_GAPS) {
      expect(capabilities.supports(gap.capability)).toBe(false);
      expect(gap.reason.length).toBeGreaterThan(0);
    }
  });

  it('withholds page-granted capabilities when the page wired nothing up', () => {
    const bare = createBrowserEditorCapabilities();
    expect(bare.supports('history')).toBe(false);
    expect(bare.supports('aiContext')).toBe(false);
    expect(bare.supports('externalLinks')).toBe(false);
    expect(bare.unavailable.map((gap) => gap.capability)).toContain('menuItems');

    const wired = createBrowserEditorCapabilities({ history: true, aiContext: true });
    expect(wired.supports('history')).toBe(true);
    expect(wired.supports('aiContext')).toBe(true);
    expect(wired.supports('menuItems')).toBe(false);
  });
});

describe('browser EditorHost', () => {
  it('rejects saveContent instead of reporting a write that never happened', async () => {
    const onCapabilityRefused = vi.fn();
    const { host: editorHost } = host({ onCapabilityRefused });

    // The whole point of the classification: a resolved save would let an
    // editor clear its dirty state over a file that does not exist.
    await expect(editorHost.saveContent('a,b\n')).rejects.toBeInstanceOf(
      BrowserEditorCapabilityError,
    );
    expect(onCapabilityRefused).toHaveBeenCalledWith(
      expect.objectContaining({ capability: 'localFileSave' }),
    );
    expect(editorHost.capabilities?.supports('localFileSave')).toBe(false);
  });

  it('omits every optional member it cannot back, so feature detection works', () => {
    const { host: editorHost } = host();
    expect(editorHost.fs).toBeUndefined();
    expect(editorHost.openExternal).toBeUndefined();
    expect(editorHost.toggleSourceMode).toBeUndefined();
    expect(editorHost.onDiffRequested).toBeUndefined();
    expect(editorHost.onFindRequested).toBeUndefined();
    expect(editorHost.getConfig).toBeUndefined();
    expect(editorHost.workspaceId).toBeUndefined();

    const openExternal = vi.fn(async () => {});
    const wired = host({ openExternal }).host;
    expect(wired.openExternal).toBeDefined();
    expect(wired.capabilities?.supports('externalLinks')).toBe(true);
  });

  it('keeps storage honest: in-memory values round-trip, secrets refuse', async () => {
    const { host: editorHost } = host();
    await editorHost.storage.set('columnWidths', [80, 120]);
    expect(editorHost.storage.get('columnWidths')).toEqual([80, 120]);
    // A resolved setSecret would claim a credential is safely held.
    await expect(editorHost.storage.setSecret('token', 'x')).rejects.toBeInstanceOf(
      BrowserEditorCapabilityError,
    );
    expect(editorHost.capabilities?.supports('persistentStorage')).toBe(false);
  });

  it('reports an unbacked AI-context push rather than swallowing it', () => {
    const onCapabilityRefused = vi.fn();
    const { host: editorHost } = host({ onCapabilityRefused });
    editorHost.setEditorContextItems([{ id: 'B2', label: 'B2', description: 'Cell B2' }]);
    expect(onCapabilityRefused).toHaveBeenCalledWith(
      expect.objectContaining({ capability: 'aiContext' }),
    );

    const sink = vi.fn();
    const wired = host({ onEditorContextItemsChange: sink }).host;
    wired.setEditorContextItems(null);
    expect(sink).toHaveBeenCalledWith(null);
  });

  it('answers permissions.filesystem as declared-but-ungranted', () => {
    const { filesystemPermission, host: editorHost } = host({
      permissions: { filesystem: true },
    });
    // Declaring the permission must not block the extension from running here,
    // but it must not be silently granted either.
    expect(filesystemPermission).toMatchObject({ declared: true, granted: false });
    expect(filesystemPermission.reason).toBeTruthy();
    expect(editorHost.capabilities?.supports('projectFileSystem')).toBe(false);
    expect(editorHost.fs).toBeUndefined();

    expect(resolveBrowserFilesystemPermission(undefined)).toMatchObject({
      declared: false,
      granted: false,
    });
  });
});

describe('browser collaboration context', () => {
  it('drains registered content flushes before awaiting the server ack', async () => {
    const order: string[] = [];
    const collaboration = collaborationContext({
      flushWithAck: async () => {
        order.push('ack');
        return true;
      },
    });
    const unregister = collaboration.registerContentFlush!(async () => {
      order.push('drain');
    });

    await expect(flushBrowserCollaborativeContent(collaboration)).resolves.toBe(true);
    // Reversed, the ack would confirm a state that still excluded the newest
    // edit sitting in the binding's debounce.
    expect(order).toEqual(['drain', 'ack']);

    unregister();
    order.length = 0;
    await flushBrowserCollaborativeContent(collaboration);
    expect(order).toEqual(['ack']);
  });
});
