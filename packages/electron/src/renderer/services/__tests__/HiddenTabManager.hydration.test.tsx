// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { EditorHost } from '@nimbalyst/runtime';
import { DocumentModel } from '../document-model/DocumentModel';
import { DocumentModelRegistry } from '../document-model/DocumentModelRegistry';
import type { DocumentBackingStore, ExternalChangeCallback } from '../document-model/types';

/**
 * NIM-5359 defect H, hidden-editor half.
 *
 * `HiddenTabManager` takes a registry handle before its host has read a single
 * byte, and the bytes it does read (`host.loadContent()`) never reach the shared
 * DocumentModel. So a hidden editor mounted for an agent tool leaves the model
 * with no baseline at all, and the reopen path it shares with every visible tab
 * has nothing to hydrate from.
 *
 * The hidden editor must initialize the shared model with what it loaded, and
 * must NOT thereby become a diff presenter -- it has no diff view, so a
 * generation it "received" could never be acknowledged.
 */

let editorAPIRegistered = false;
let mountedHost: EditorHost | null = null;

function StubExtensionEditor({ host }: { host: EditorHost }) {
  useEffect(() => {
    mountedHost = host;
    void host.loadContent().then(() => {
      editorAPIRegistered = true;
    });
  }, [host]);
  return null;
}

vi.mock('@nimbalyst/runtime', () => ({
  createEditorAPIOwnerToken: (id: string) => ({ id } as unknown),
  createExtensionStorage: () => ({
    get: () => undefined,
    set: async () => {},
    delete: async () => {},
    getGlobal: () => undefined,
    setGlobal: async () => {},
    deleteGlobal: async () => {},
    getSecret: async () => undefined,
    setSecret: async () => {},
    deleteSecret: async () => {},
  }),
  getExtensionLoader: () => ({
    findEditorForExtension: () => ({
      extensionId: 'test.hidden-editor',
      component: StubExtensionEditor,
    }),
  }),
  hasExtensionEditorAPI: () => editorAPIRegistered,
  registerEditorAPI: () => {},
  unregisterEditorAPI: () => {},
}));

const FILE_PATH = '/test/hidden.excalidraw';
const AGENT_CONTENT = 'agent content';
const PRE_EDIT_CONTENT = 'pre-edit content';

let externalChange: ExternalChangeCallback | null = null;

function createStore(): DocumentBackingStore & { dispose: () => void } {
  return {
    load: vi.fn(async () => AGENT_CONTENT),
    save: vi.fn(async () => {}),
    onExternalChange: vi.fn((cb: ExternalChangeCallback) => {
      externalChange = cb;
      return () => {
        externalChange = null;
      };
    }),
    dispose: vi.fn(),
  };
}

describe('HiddenTabManager initializes the shared document model', () => {
  beforeEach(() => {
    editorAPIRegistered = false;
    mountedHost = null;
    externalChange = null;

    (window as unknown as { electronAPI: unknown }).electronAPI = {
      readFileContent: vi.fn(async () => ({ success: true, content: AGENT_CONTENT })),
      saveFile: vi.fn(async () => ({ success: true })),
      invoke: vi.fn(async () => null),
      send: vi.fn(),
      on: vi.fn(() => () => {}),
    };

    DocumentModelRegistry.clear();
    DocumentModelRegistry.setModelFactory((filePath: string) =>
      new DocumentModel(filePath, createStore(), {
        autosaveInterval: 0,
        getPendingTags: async () => [
          { id: 'tag-1', sessionId: 'sess-1', createdAt: '2026-09-01T00:00:00Z' },
        ],
        getDiffBaseline: async () => ({ content: PRE_EDIT_CONTENT }),
        updateTagStatus: async () => {},
      }),
    );
  });

  afterEach(() => {
    DocumentModelRegistry.clear();
    DocumentModelRegistry.setModelFactory(null);
    vi.resetModules();
  });

  it('hydrates the model from the bytes its host loaded, without becoming a diff presenter', async () => {
    const { hiddenTabManager } = await import('../HiddenTabManager');

    await hiddenTabManager.ensureEditor(FILE_PATH, '/test');
    // Let the host's own loadContent settle.
    await vi.waitFor(() => expect(mountedHost).not.toBeNull());
    await Promise.resolve();

    const model = DocumentModelRegistry.get(FILE_PATH)!;
    expect(model.getLastPersistedContent()).toBe(AGENT_CONTENT);

    // An agent write arrives while only the hidden editor is attached. A hidden
    // editor has no diff view, so it is not a recipient: the generation waits
    // for a real presenter instead of sitting in `applying` forever.
    externalChange?.({ content: 'newer agent content', timestamp: Date.now() });
    await vi.waitFor(() => expect(model.getDiffSessionSnapshot()).not.toBeNull());

    expect(model.getDiffSessionSnapshot()?.phase).toBe('awaiting-presenter');

    hiddenTabManager.release(FILE_PATH);
  });
});
