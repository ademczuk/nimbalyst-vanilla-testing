// @vitest-environment jsdom
import React, { useEffect, useLayoutEffect } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { DocumentModel } from '../DocumentModel';
import { DocumentModelRegistry } from '../DocumentModelRegistry';
import type { DocumentBackingStore, DocumentModelEditorHandle } from '../types';
import { useDocumentModel } from '../useDocumentModel';

function createMockStore(): DocumentBackingStore & { dispose: () => void } {
  return {
    load: vi.fn(async () => ''),
    save: vi.fn(async () => {}),
    onExternalChange: vi.fn(() => () => {}),
    dispose: vi.fn(),
  };
}

interface Snapshot {
  handle: DocumentModelEditorHandle;
  model: DocumentModel;
}

function Probe({
  filePath,
  label,
  onSnapshot,
}: {
  filePath: string;
  label: string;
  onSnapshot: (label: string, snapshot: Snapshot) => void;
}) {
  const { model, handle } = useDocumentModel(filePath, {
    autosaveInterval: 0,
    getPendingTags: async () => [],
    updateTagStatus: async () => {},
  });

  useLayoutEffect(() => {
    onSnapshot(label, { model, handle });
  }, [handle, label, model, onSnapshot]);

  return null;
}

describe('useDocumentModel rename lifecycle', () => {
  beforeEach(() => {
    DocumentModelRegistry.clear();
    DocumentModelRegistry.setModelFactory((filePath: string) => {
      return new DocumentModel(filePath, createMockStore(), {
        autosaveInterval: 0,
        getPendingTags: async () => [],
        updateTagStatus: async () => {},
      });
    });
  });

  afterEach(() => {
    DocumentModelRegistry.clear();
    DocumentModelRegistry.setModelFactory(null);
  });

  it('keeps the same attachment when the component rerenders with the renamed path', () => {
    const snapshots = new Map<string, Snapshot>();
    const onSnapshot = (label: string, snapshot: Snapshot) => {
      snapshots.set(label, snapshot);
    };

    const view = render(
      <Probe filePath="/test/old.md" label="editor" onSnapshot={onSnapshot} />,
    );

    const first = snapshots.get('editor')!;
    first.handle.setDirty(true);

    expect(DocumentModelRegistry.rename('/test/old.md', '/test/new.md')).toBe(true);

    view.rerender(
      <Probe filePath="/test/new.md" label="editor" onSnapshot={onSnapshot} />,
    );

    const second = snapshots.get('editor')!;
    expect(second.model).toBe(first.model);
    expect(second.handle).toBe(first.handle);
    expect(second.model.isDirty()).toBe(true);

    view.unmount();
    expect(DocumentModelRegistry.has('/test/new.md')).toBe(false);
  });

  it('reuses the migrated model during an overlapped remount and cleans up the old handle', () => {
    const snapshots = new Map<string, Snapshot>();
    const onSnapshot = (label: string, snapshot: Snapshot) => {
      snapshots.set(label, snapshot);
    };

    const view = render(
      <Probe filePath="/test/old.md" label="old" onSnapshot={onSnapshot} />,
    );

    const first = snapshots.get('old')!;
    first.handle.setDirty(true);

    expect(DocumentModelRegistry.rename('/test/old.md', '/test/new.md')).toBe(true);

    view.rerender(
      <>
        <Probe filePath="/test/old.md" label="old" onSnapshot={onSnapshot} />
        <Probe filePath="/test/new.md" label="new" onSnapshot={onSnapshot} />
      </>,
    );

    const replacement = snapshots.get('new')!;
    expect(replacement.model).toBe(first.model);
    expect(replacement.model.getAttachCount()).toBe(2);

    view.rerender(
      <Probe filePath="/test/new.md" label="new" onSnapshot={onSnapshot} />,
    );

    const active = snapshots.get('new')!;
    expect(active.model).toBe(first.model);
    expect(active.model.getAttachCount()).toBe(1);
    expect(active.model.isDirty()).toBe(true);

    view.unmount();
    expect(DocumentModelRegistry.has('/test/new.md')).toBe(false);
  });
});

/**
 * NIM-5359 defect H: pending-diff hydration must run through a seam a real
 * editor uses.
 *
 * `DocumentModel.loadContent()` is called by tests and by nothing else in the
 * renderer -- TabEditor seeds the model synchronously with
 * `setLastPersistedContent(initialContent)` and custom editors load through
 * `EditorHost.loadContent`. A hydration test written against `loadContent()`
 * would go green while deleting the mount path removes the only production
 * reopen path there is.
 *
 * This probe stands in for TabEditor's mount effect: it acquires the model the
 * way a real editor does, subscribes to diff requests, and hands the model the
 * bytes it "loaded". What it cannot prove is that TabEditor itself makes that
 * call -- TabEditor is not mountable in a unit test. The incident-shaped E2E
 * (plan item 1a) and the Phase 5 `getOrCreate` consumer audit cover that half.
 */
function HydrationProbe({
  filePath,
  initialContent,
  onDiff,
}: {
  filePath: string;
  initialContent: string;
  onDiff: (state: { oldContent: string; newContent: string }) => void;
}) {
  const { model, handle } = useDocumentModel(filePath, { autosaveInterval: 0 });

  useEffect(() => handle.onDiffRequested(onDiff), [handle, onDiff]);
  useEffect(() => {
    void model.ensureInitialized(initialContent);
  }, [model, initialContent]);

  return null;
}

describe('pending diff hydration through the editor mount seam', () => {
  const loadCalls = { count: 0 };

  beforeEach(() => {
    loadCalls.count = 0;
    DocumentModelRegistry.clear();
    DocumentModelRegistry.setModelFactory((filePath: string) => {
      const store: DocumentBackingStore & { dispose: () => void } = {
        // Disk already holds the agent's write; the editor read it before mount.
        load: vi.fn(async () => {
          loadCalls.count++;
          return 'agent content';
        }),
        save: vi.fn(async () => {}),
        onExternalChange: vi.fn(() => () => {}),
        dispose: vi.fn(),
      };
      return new DocumentModel(filePath, store, {
        autosaveInterval: 0,
        getPendingTags: async () => [
          { id: 'tag-1', sessionId: 'sess-1', createdAt: '2026-09-01T00:00:00Z' },
        ],
        getDiffBaseline: async () => ({ content: 'pre-edit content' }),
        updateTagStatus: async () => {},
      });
    });
  });

  afterEach(() => {
    DocumentModelRegistry.clear();
    DocumentModelRegistry.setModelFactory(null);
  });

  it('delivers the reopened diff to the ordinary subscription, without re-reading disk', async () => {
    const onDiff = vi.fn();

    await act(async () => {
      render(
        <HydrationProbe
          filePath="/test/plan.md"
          initialContent="agent content"
          onDiff={onDiff}
        />,
      );
    });

    expect(onDiff).toHaveBeenCalledTimes(1);
    expect(onDiff.mock.calls[0][0]).toMatchObject({
      oldContent: 'pre-edit content',
      newContent: 'agent content',
    });
    // Hydration works from the bytes the editor already loaded.
    expect(loadCalls.count).toBe(0);
  });
});
