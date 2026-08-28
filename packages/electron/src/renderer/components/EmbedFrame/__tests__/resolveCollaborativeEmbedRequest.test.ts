// @vitest-environment node
/**
 * Which shared documents may be embedded, and by what.
 *
 * The gate is opt-in per caller, and that is the part worth pinning. A canvas
 * card mounts Lexical itself, so a shared markdown document is a card like any
 * other. `EmbedFrame` is *already inside* a Lexical editor, so the same
 * document must keep being refused there -- and the difference between the two
 * is one flag on the input, which is exactly the kind of thing that gets
 * "simplified" into always-on by someone who only sees the canvas working.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveMetadata = vi.fn();
const findRegistrationForFile = vi.fn();

vi.mock('../../../services/CollaborativeDocumentTypeCatalog', () => ({
  getCollaborativeDocumentTypeCatalog: () => ({
    resolveMetadata: (...args: unknown[]) => resolveMetadata(...args),
    resolveShareability: () => null,
    editorIdForDescriptor: () => 'builtin.lexical',
  }),
}));

vi.mock('../../CustomEditors/registry', () => ({
  customEditorRegistry: {
    findRegistrationForFile: (path: string) => findRegistrationForFile(path),
  },
}));

const { resolveCollaborativeEmbedRequest } = await import(
  '../resolveCollaborativeEmbedRequest'
);

const BASE = {
  orgId: 'org-1',
  documentId: 'doc-9',
  workspacePath: '/ws',
  sharedTitle: 'Launch plan',
};

function descriptorOf(kind: 'lexical' | 'extension') {
  return {
    state: 'ready' as const,
    descriptor: {
      documentType: kind === 'lexical' ? 'markdown' : 'excalidraw',
      defaultExtension: kind === 'lexical' ? '.md' : '.excalidraw',
      editor: { kind },
    },
  };
}

beforeEach(() => {
  resolveMetadata.mockReset();
  findRegistrationForFile.mockReset();
});

describe('collaborative embed resolution', () => {
  it('only accepts a markdown document from a caller that opted in', () => {
    resolveMetadata.mockReturnValue(descriptorOf('lexical'));

    const forCanvas = resolveCollaborativeEmbedRequest({
      ...BASE,
      sharedDocumentType: 'markdown',
      allowLexical: true,
    });
    expect(forCanvas.status).toBe('ready');
    // No registration is looked up: markdown has none, and asking for one is
    // how this used to fail.
    expect(findRegistrationForFile).not.toHaveBeenCalled();
    expect(forCanvas.status === 'ready' && forCanvas.editor).toEqual({
      kind: 'lexical',
    });
    expect(forCanvas.status === 'ready' && forCanvas.displayName).toBe(
      'Launch plan'
    );

    // The in-document embed does not pass the flag and must still refuse.
    expect(
      resolveCollaborativeEmbedRequest({ ...BASE, sharedDocumentType: 'markdown' })
        .status
    ).toBe('unavailable');
  });

  it('still requires an extension to declare collaboration support', () => {
    resolveMetadata.mockReturnValue(descriptorOf('extension'));

    findRegistrationForFile.mockReturnValue({ collaboration: { supported: false } });
    expect(
      resolveCollaborativeEmbedRequest({
        ...BASE,
        sharedDocumentType: 'excalidraw',
        allowLexical: true,
      }).status
    ).toBe('unavailable');

    const registration = { collaboration: { supported: true } };
    findRegistrationForFile.mockReturnValue(registration);
    const resolved = resolveCollaborativeEmbedRequest({
      ...BASE,
      sharedDocumentType: 'excalidraw',
      allowLexical: true,
    });
    expect(resolved.status === 'ready' && resolved.editor).toEqual({
      kind: 'extension',
      registration,
    });
  });
});
