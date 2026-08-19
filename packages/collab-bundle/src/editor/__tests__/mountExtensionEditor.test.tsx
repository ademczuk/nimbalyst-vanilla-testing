import { act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { asTeamMemberId } from '@nimbalyst/runtime/auth/jwtScopes';
import type { EditorHost } from '@nimbalyst/extension-sdk/types/editor';
import { mountExtensionEditor, type ExtensionEditorHandle } from '../mountExtensionEditor';
import { BrowserEditorCapabilityError } from '../browserEditorCapabilities';

const mountedHandles: ExtensionEditorHandle[] = [];

async function settle(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 20; index++) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  for (const handle of mountedHandles.splice(0)) handle.destroy();
  document.body.replaceChildren();
});

const USER = { memberId: asTeamMemberId('member-ada'), name: 'Ada' };

/**
 * Stands in for an extension's editor contribution: reads the shared Y.Text the
 * way a real collaborative editor does, and records the host it was handed.
 */
function csvEditorDouble(observed: { host?: EditorHost }) {
  return function CsvEditorDouble({ host }: { host: EditorHost }) {
    observed.host = host;
    const text = host.collaboration?.yDoc.getText('csv').toString() ?? '';
    return <pre data-testid="grid">{text}</pre>;
  };
}

async function mount(
  options: Partial<Parameters<typeof mountExtensionEditor>[0]> = {},
): Promise<{ handle: ExtensionEditorHandle; element: HTMLElement; observed: { host?: EditorHost } }> {
  const yDocument = new Y.Doc();
  yDocument.getText('csv').insert(0, 'name,total\nAda,7\n');
  const element = document.createElement('div');
  document.body.append(element);
  const observed: { host?: EditorHost } = {};
  let handle!: ExtensionEditorHandle;
  await act(async () => {
    handle = mountExtensionEditor({
      element,
      source: { kind: 'in-memory', document: yDocument },
      user: USER,
      component: csvEditorDouble(observed),
      fileName: 'budget.csv',
      documentId: 'doc-1',
      ...options,
    });
  });
  mountedHandles.push(handle);
  await settle();
  return { handle, element, observed };
}

describe('mounting an extension editor over a collaborative document', () => {
  it('hands the editor the shared document, awareness identity and a browser host', async () => {
    const { handle, element, observed } = await mount();

    expect(element.querySelector('[data-testid="grid"]')?.textContent)
      .toBe('name,total\nAda,7\n');

    const host = observed.host!;
    // Same Y.Doc object, not a copy: an extension binding writes through it.
    expect(host.collaboration?.yDoc).toBe(handle.getDocument());
    expect(host.collaboration?.awareness.getLocalState()).toMatchObject({
      user: { id: 'member-ada', name: 'Ada' },
    });
    expect(host.filePath).toBe('collab://doc-1/budget.csv');
    expect(host.capabilities?.environment).toBe('browser');

    // A remote edit reaches the editor through the Y.Doc it already holds.
    await act(async () => {
      handle.getDocument().getText('csv').insert(0, 'x,y\n');
    });
    expect(host.collaboration?.yDoc.getText('csv').toString())
      .toBe('x,y\nname,total\nAda,7\n');
    expect(handle.getState().edit).toBe('dirty');
  });

  it('surfaces a refused capability to the page instead of failing silently', async () => {
    const onCapabilityRefused = vi.fn();
    const { observed } = await mount({ onCapabilityRefused });

    await expect(observed.host!.saveContent('name,total\n')).rejects
      .toBeInstanceOf(BrowserEditorCapabilityError);
    expect(onCapabilityRefused).toHaveBeenCalledWith(
      expect.objectContaining({ capability: 'localFileSave' }),
    );
  });

  it('routes the editor API, dirty state and theme through the handle', async () => {
    const { handle, observed } = await mount({ theme: 'dark' });
    const host = observed.host!;
    expect(host.theme).toBe('dark');

    const seenThemes: string[] = [];
    host.onThemeChanged((theme) => seenThemes.push(theme));
    handle.setTheme('light');
    expect(seenThemes).toEqual(['light']);

    const api = { insertRow: () => {} };
    host.registerEditorAPI(api);
    expect(handle.getEditorAPI()).toBe(api);

    host.setDirty(false);
    expect(handle.getState().edit).toBe('clean');
  });

  it('tears down the React root and the awareness bridge on destroy', async () => {
    const { handle, element, observed } = await mount();
    const awareness = observed.host!.collaboration!.awareness;

    await act(async () => { handle.destroy(); });

    expect(element.querySelector('[data-testid="grid"]')).toBeNull();
    expect(awareness.getLocalState()).toBeNull();
    // Destroy is idempotent; the page may unmount a document it already closed.
    expect(() => handle.destroy()).not.toThrow();
  });
});
