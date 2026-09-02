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

describe('the comments service the mount puts on the collaboration context', () => {
  const SEAM = {
    currentUser: { id: 'member-ada', name: 'Ada' },
    getMembers: () => [
      { userId: 'member-ada', name: 'Ada' },
      { userId: 'member-bo', name: 'Bo' },
    ],
    documentTitle: 'budget.csv',
    documentId: 'doc-1',
    documentUri: 'nimbalyst://doc/doc-1',
  };

  /**
   * The absent case is the whole point of the capability being optional. A
   * page that cannot answer who the author is or who may comment -- the
   * in-memory harness, a signed-out surface -- must leave the extension with
   * nothing to feature-detect against, not a service that accepts comments
   * into a document no one else will ever see.
   */
  it('leaves comments absent, not stubbed, when the page supplies no seam', async () => {
    const { observed } = await mount();
    const collaboration = observed.host!.collaboration!;

    expect(collaboration.comments).toBeUndefined();
    expect('comments' in collaboration).toBe(false);
  });

  it('reads the same shared document the extension was handed', async () => {
    const { observed } = await mount({ comments: SEAM });
    const collaboration = observed.host!.collaboration!;
    const comments = collaboration.comments!;

    expect(comments.getMentionableMembers().map((member) => member.userId))
      .toEqual(['member-bo']);
    // A peer's thread already in the room, not one this client authored.
    collaboration.yDoc.getArray('comments').insert(0, [(() => {
      const thread = new Y.Map<unknown>();
      thread.set('type', 'thread');
      thread.set('id', 'thread-1');
      thread.set('quote', 'Pin 1 — Save changes');
      thread.set('resolved', false);
      thread.set('comments', new Y.Array());
      return thread;
    })()]);

    expect(comments.getSnapshot()).toHaveLength(1);
  });

  /**
   * `canComment` is answered from a roster that resolves after this mount, so
   * the first answer on a cold open is "not yet known". Without a way to
   * re-publish it the affordance would stay hidden for the rest of the session.
   */
  it('republishes a host answer that resolved after the mount', async () => {
    let permitted = false;
    const { handle, observed } = await mount({
      comments: { ...SEAM, canComment: () => permitted },
    });
    const comments = observed.host!.collaboration!.comments!;
    const seen: boolean[] = [];
    comments.subscribe(() => seen.push(comments.getCapabilities().comment));

    expect(comments.getCapabilities().comment).toBe(false);
    permitted = true;
    handle.refreshCommentAccess();

    expect(seen).toEqual([true]);
    expect(comments.getCapabilities().comment).toBe(true);
  });
});

/**
 * Source mode swaps what the reader sees, not the document they are reading.
 *
 * The obvious implementation -- hand the mount a different `component` -- makes
 * the toggle a mount dependency, and a new component destroys a live Y.Doc
 * behind a flush. So the flag lives in the mount and the mounted component
 * picks a view from it; these tests pin both halves of that.
 */
describe('source mode', () => {
  it('withholds the capability and every member when the page did not grant it', async () => {
    const { handle, observed } = await mount();

    expect(observed.host!.supportsSourceMode).toBeUndefined();
    expect(observed.host!.toggleSourceMode).toBeUndefined();
    expect(observed.host!.onSourceModeChanged).toBeUndefined();
    expect(handle.capabilities.supports('sourceMode')).toBe(false);
    // An ungranted mount still answers the question, it just always says no --
    // and a page control that calls it anyway must not flip anything.
    handle.setSourceMode(true);
    expect(handle.isSourceModeActive()).toBe(false);
  });

  it('keeps the extension and the page looking at one flag, over one Y.Doc', async () => {
    const changes: boolean[] = [];
    const { handle, observed } = await mount({
      enableSourceMode: true,
      onSourceModeChange: (active) => changes.push(active),
    });
    const editorHost = observed.host!;
    const document = handle.getDocument();
    const seen: boolean[] = [];
    editorHost.onSourceModeChanged!((active) => seen.push(active));

    expect(editorHost.supportsSourceMode).toBe(true);
    expect(handle.capabilities.supports('sourceMode')).toBe(true);

    // The extension's own control...
    editorHost.toggleSourceMode!();
    expect(editorHost.isSourceModeActive!()).toBe(true);
    expect(handle.isSourceModeActive()).toBe(true);
    // ...and the page's, which is a different caller reading the same answer.
    handle.setSourceMode(false);
    expect(editorHost.isSourceModeActive!()).toBe(false);

    expect(seen).toEqual([true, false]);
    expect(changes).toEqual([true, false]);
    // The point of putting the flag here: the room is untouched by a toggle.
    expect(handle.getDocument()).toBe(document);
    expect(document.getText('csv').toString()).toBe('name,total\nAda,7\n');
  });
});
