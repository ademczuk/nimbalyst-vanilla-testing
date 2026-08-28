/**
 * What a canvas card actually mounts.
 *
 * Two failures live here, and both are invisible on screen -- which is why
 * they need tests rather than a look at the board.
 *
 * A card pinned to a revision is styled as history and locked read-only by the
 * runtime, so it *looks* right whatever it mounts. If the host opens the live
 * room anyway, the card renders head under a "v3" label and two cards pinned to
 * two revisions are the same document twice, with nothing to say so. The
 * feature was exactly this broken while its unit test -- which asserted only
 * the reference metadata the pin writes -- passed.
 *
 * A file card that cools inside the two-second autosave debounce loses the
 * edit, because the timer is cleared and the warm host then refuses the write.
 * Zoom out after typing and the bytes are gone; nothing reports it.
 */
import React, { useEffect } from 'react';
import { atom } from 'jotai';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Doc } from 'yjs';

import type { EditorHost } from '@nimbalyst/runtime';

const writeFileToDisk = vi.fn<(path: string, text: string) => Promise<void>>();
const loadCanvasRevisionSnapshot = vi.fn();
const findRegistrationForFile = vi.fn();
const resolveCollaborativeEmbedRequest = vi.fn();

vi.mock('../../../hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'dark' }),
}));

vi.mock('@nimbalyst/runtime/store', () => ({
  store: { sub: () => () => {} },
}));

vi.mock('../../../store/atoms/fileWatch', () => ({
  fileChangedOnDiskAtomFamily: (path: string) => atom(path),
}));

vi.mock('../../../store/atoms/openProjects', () => ({
  activeWorkspacePathAtom: atom<string | null>('/ws'),
}));

vi.mock('../../../store/atoms/collabDocuments', () => ({
  activeTeamOrgIdAtom: atom<string | null>('org-1'),
  sharedDocumentsAtom: atom([]),
}));

vi.mock('../../../services/CollaborativeEmbedProviderCache', () => ({
  collaborativeEmbedResourceKey: (request: { documentId: string }) =>
    `room:${request.documentId}`,
}));

vi.mock('../../CustomEditors/registry', () => ({
  customEditorRegistry: {
    findRegistrationForFile: (path: string) => findRegistrationForFile(path),
  },
}));

vi.mock('../embeddedFileIo', () => ({
  readFileFromDisk: async () => 'on disk',
  writeFileToDisk: (path: string, text: string) => writeFileToDisk(path, text),
  workspaceAbsolutePath: (path: string) => `/ws/${path}`,
}));

vi.mock('../resolveCollaborativeEmbedRequest', () => ({
  resolveCollaborativeEmbedRequest: (input: unknown) =>
    resolveCollaborativeEmbedRequest(input),
}));

// The live-room mount. Its presence in the tree is the whole assertion for a
// pinned card: it must not be there.
vi.mock('../CollaborativeEmbedEditor', () => ({
  CollaborativeEmbedEditor: () => <div data-testid="live-room" />,
}));

vi.mock('../canvasRevisionSnapshot', () => ({
  loadCanvasRevisionSnapshot: (request: unknown) =>
    loadCanvasRevisionSnapshot(request),
  CanvasRevisionSnapshotError: class extends Error {},
}));

// Narrowed to the two members the card reads. The real factory reaches the
// runtime barrel, the AI context store, and the editor-API registry, none of
// which this file is about.
vi.mock('../../TabEditor/collabExtensionHost', () => ({
  createCollabExtensionHost: (args: Record<string, unknown>) => args,
}));

const { CanvasCardHost } = await import('../CanvasCardHost');

/** Renders whichever content its host makes reachable, and nothing else. */
function BodyText({ host }: { host: EditorHost }) {
  const collaboration = (host as unknown as { collaboration?: { yDoc: Doc } })
    .collaboration;
  return (
    <div data-testid="card-body">
      {collaboration ? collaboration.yDoc.getText('body').toString() : ''}
    </div>
  );
}

const DOC_REGISTRATION = { component: BodyText, collaboration: { supported: true } };

function readyResolution() {
  return {
    status: 'ready' as const,
    editor: { kind: 'extension' as const, registration: DOC_REGISTRATION },
    displayName: 'Login',
    request: {
      workspacePath: '/ws',
      orgId: 'org-1',
      documentId: 'doc-9',
      title: 'Login',
      documentType: 'markdown',
      metadata: { metadataVersion: 2 as const, fileExtension: '.md', editorId: 'md' },
    },
  };
}

beforeEach(() => {
  writeFileToDisk.mockReset().mockResolvedValue(undefined);
  loadCanvasRevisionSnapshot.mockReset();
  findRegistrationForFile.mockReset();
  resolveCollaborativeEmbedRequest.mockReset().mockReturnValue(readyResolution());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('pinned revision cards', () => {
  function snapshotDoc(text: string): Doc {
    const doc = new Doc();
    doc.getText('body').insert(0, text);
    return doc;
  }

  it('mounts the stored revision, not the live room', async () => {
    loadCanvasRevisionSnapshot.mockResolvedValue({
      doc: snapshotDoc('as of v3'),
      config: { teamMemberId: 'member-1', userName: 'Greg' },
    });

    render(
      <CanvasCardHost
        nodeId="node-1"
        reference={{
          kind: 'doc',
          uri: 'nimbalyst://doc/org-1/doc-9',
          revisionId: 'rev-3',
        }}
        label="Login v3"
        detail="warm"
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('card-body').textContent).toBe('as of v3'),
    );
    expect(screen.queryByTestId('live-room')).toBeNull();
    expect(loadCanvasRevisionSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        documentId: 'doc-9',
        revisionId: 'rev-3',
        documentType: 'markdown',
      }),
    );
  });

  it('still follows head for a card that names no revision', () => {
    render(
      <CanvasCardHost
        nodeId="node-1"
        reference={{ kind: 'doc', uri: 'nimbalyst://doc/org-1/doc-9' }}
        label="Login"
        detail="warm"
      />,
    );

    screen.getByTestId('live-room');
    expect(loadCanvasRevisionSnapshot).not.toHaveBeenCalled();
  });

  it('says why rather than rendering an empty document', async () => {
    loadCanvasRevisionSnapshot.mockRejectedValue(
      new Error('Past revisions of markdown documents cannot be shown yet.'),
    );

    render(
      <CanvasCardHost
        nodeId="node-1"
        reference={{
          kind: 'doc',
          uri: 'nimbalyst://doc/org-1/doc-9',
          revisionId: 'rev-3',
        }}
        label="Login v3"
        detail="warm"
      />,
    );

    await waitFor(() =>
      screen.getByText('Past revisions of markdown documents cannot be shown yet.'),
    );
    expect(screen.queryByTestId('card-body')).toBeNull();
  });
});

describe('file card autosave', () => {
  /** Marks itself dirty on mount and answers save requests with fixed bytes. */
  function DirtyEditor({ host }: { host: EditorHost }) {
    useEffect(() => {
      host.setDirty(true);
      return host.onSaveRequested(() => host.saveContent('edited bytes'));
    }, [host]);
    return <div data-testid="file-card" />;
  }

  beforeEach(() => {
    findRegistrationForFile.mockReturnValue({ component: DirtyEditor });
  });

  const fileCard = (detail: 'warm' | 'hot') => (
    <CanvasCardHost
      nodeId="node-1"
      reference={{ kind: 'file', path: 'notes.md' }}
      label="Notes"
      detail={detail}
    />
  );

  it('lands the bytes when a dirty card cools inside the debounce window', async () => {
    const view = render(fileCard('hot'));
    screen.getByTestId('file-card');
    // No two-second tick has fired: the edit exists only in the extension.
    expect(writeFileToDisk).not.toHaveBeenCalled();

    view.rerender(fileCard('warm'));

    await waitFor(() =>
      expect(writeFileToDisk).toHaveBeenCalledWith('/ws/notes.md', 'edited bytes'),
    );
  });

  it('lands the bytes when the board closes on a dirty card', async () => {
    const view = render(fileCard('hot'));
    expect(writeFileToDisk).not.toHaveBeenCalled();

    view.unmount();

    await waitFor(() =>
      expect(writeFileToDisk).toHaveBeenCalledWith('/ws/notes.md', 'edited bytes'),
    );
  });

  it('does not write for a card that was never edited', async () => {
    findRegistrationForFile.mockReturnValue({
      component: () => <div data-testid="file-card" />,
    });
    const view = render(fileCard('hot'));
    view.rerender(fileCard('warm'));
    view.unmount();

    await Promise.resolve();
    expect(writeFileToDisk).not.toHaveBeenCalled();
  });
});
