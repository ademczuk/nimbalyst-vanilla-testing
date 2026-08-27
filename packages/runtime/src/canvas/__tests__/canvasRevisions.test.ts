// @vitest-environment node

/**
 * Two invisible rules, both quietly wrong when broken and neither visible on
 * screen: which content a pinned card resolves to, and which session a
 * revision is credited to. The rail's rendering is deliberately untested --
 * a strip that fails to paint is a one-second observation.
 */

import { describe, expect, it } from 'vitest';

import { NIMBALYST_CANVAS_NAMESPACE, type CanvasDocument } from '../CanvasDocument';
import {
  assembleCanvasRevisions,
  canvasCardDocumentUri,
  effectiveCanvasCardReference,
  pinCanvasRevisionCard,
  resolveCanvasCardRevision,
  type CanvasRevisionRecord,
} from '../canvasRevisions';
import type { CanvasCardReference } from '../canvasCallbacks';

describe('resolveCanvasCardRevision', () => {
  it('pins a doc card to its named revision and follows head without one', () => {
    expect(
      resolveCanvasCardRevision({
        kind: 'doc',
        uri: 'nimbalyst://doc/org-1/doc-1',
        revisionId: 'rev-7',
      })
    ).toEqual({ revisionId: 'rev-7', pinned: true });

    expect(
      resolveCanvasCardRevision({
        kind: 'doc',
        uri: 'nimbalyst://doc/org-1/doc-1',
      })
    ).toEqual({ revisionId: null, pinned: false });
  });

  it('reads a file card pin off its shared binding, not the path', () => {
    expect(
      resolveCanvasCardRevision({
        kind: 'file',
        path: 'design/login.mockup.html',
        sharedAs: { uri: 'nimbalyst://doc/org-1/doc-1', revisionId: 'rev-3' },
      })
    ).toEqual({ revisionId: 'rev-3', pinned: true });

    // No shared identity means no revision exists to point at.
    expect(
      resolveCanvasCardRevision({
        kind: 'file',
        path: 'design/login.mockup.html',
      })
    ).toEqual({ revisionId: null, pinned: false });
  });

  it('treats an empty or non-string revisionId as head', () => {
    expect(
      resolveCanvasCardRevision({
        kind: 'doc',
        uri: 'nimbalyst://doc/org-1/doc-1',
        revisionId: '',
      }).pinned
    ).toBe(false);
    expect(
      resolveCanvasCardRevision({
        kind: 'doc',
        uri: 'nimbalyst://doc/org-1/doc-1',
        revisionId: 42 as unknown as string,
      }).pinned
    ).toBe(false);
  });
});

describe('effectiveCanvasCardReference', () => {
  const pinnedFileCard: CanvasCardReference = {
    kind: 'file',
    path: 'design/login.mockup.html',
    sharedAs: { uri: 'nimbalyst://doc/org-1/doc-1', revisionId: 'rev-3' },
  };

  it('mounts a pinned file card through its shared document even when the host prefers local files', () => {
    // The failure this guards: rendering the local path for a pinned card
    // shows head under a "v3" label -- right-looking, wrong content.
    expect(
      effectiveCanvasCardReference(pinnedFileCard, { preferShared: false })
    ).toEqual({
      kind: 'doc',
      uri: 'nimbalyst://doc/org-1/doc-1',
      revisionId: 'rev-3',
    });
  });

  it('leaves an unpinned shared file card on the local path unless the host prefers shared', () => {
    const headCard: CanvasCardReference = {
      kind: 'file',
      path: 'design/login.mockup.html',
      sharedAs: { uri: 'nimbalyst://doc/org-1/doc-1' },
    };
    expect(
      effectiveCanvasCardReference(headCard, { preferShared: false })
    ).toBe(headCard);
    expect(
      effectiveCanvasCardReference(headCard, { preferShared: true })
    ).toEqual({ kind: 'doc', uri: 'nimbalyst://doc/org-1/doc-1' });
  });

  it('reports the document a card would list revisions against', () => {
    expect(canvasCardDocumentUri(pinnedFileCard)).toBe(
      'nimbalyst://doc/org-1/doc-1'
    );
    expect(
      canvasCardDocumentUri({ kind: 'file', path: 'notes/private.md' })
    ).toBeNull();
  });
});

describe('assembleCanvasRevisions', () => {
  const revisions: CanvasRevisionRecord[] = [
    { revisionId: 'rev-1', createdAt: 1_000, createdBy: 'user-a' },
    { revisionId: 'rev-2', createdAt: 2_000, createdBy: 'user-a' },
    { revisionId: 'rev-3', createdAt: 3_000, createdBy: 'user-b' },
  ];

  it('numbers oldest-first, returns newest-first, and names the author', () => {
    const entries = assembleCanvasRevisions(
      // Deliberately unsorted: the server pages newest-first.
      [revisions[2], revisions[0], revisions[1]],
      { displayNames: new Map([['user-b', 'Sam']]) }
    );
    expect(entries.map((entry) => [entry.revisionId, entry.sequence])).toEqual([
      ['rev-3', 3],
      ['rev-2', 2],
      ['rev-1', 1],
    ]);
    expect(entries[0].provenance.authorName).toBe('Sam');
    // An unknown member is reported by id rather than guessed at.
    expect(entries[1].provenance.authorName).toBeNull();
    expect(entries[1].provenance.authorUserId).toBe('user-a');
  });

  it('credits each revision only to edits inside its own window', () => {
    const entries = assembleCanvasRevisions(revisions, {
      edits: [
        { sessionId: 's1', sessionName: 'First', editedAt: 900, prompt: 'p1' },
        { sessionId: 's2', sessionName: 'Second', editedAt: 1_500, prompt: 'p2' },
        { sessionId: 's3', sessionName: 'Third', editedAt: 1_900, prompt: 'p3' },
      ],
    });
    const byId = new Map(entries.map((entry) => [entry.revisionId, entry]));

    // rev-1 takes the only edit before it.
    expect(byId.get('rev-1')?.provenance.sessionId).toBe('s1');
    // rev-2 takes the latest edit in (1000, 2000] -- s3, not s2.
    expect(byId.get('rev-2')?.provenance.sessionId).toBe('s3');
    expect(byId.get('rev-2')?.provenance.prompt).toBe('p3');
    // rev-3's window is empty. The regression this guards is a nearest-match
    // that would credit s3 again and stamp its name on every later revision.
    expect(byId.get('rev-3')?.provenance.sessionId).toBeNull();
    expect(byId.get('rev-3')?.provenance.prompt).toBeNull();
    expect(byId.get('rev-3')?.provenance.commit).toBeNull();
  });

  it('reports the first commit the credited session landed after the snapshot', () => {
    const entries = assembleCanvasRevisions([revisions[1]], {
      edits: [
        { sessionId: 's2', sessionName: 'Second', editedAt: 1_500, prompt: null },
      ],
      commits: [
        // Before the snapshot: shipped something earlier in the same session.
        { sha: 'aaa1111', subject: null, sessionId: 's2', committedAt: 1_600 },
        { sha: 'bbb2222', subject: 'ship it', sessionId: 's2', committedAt: 2_400 },
        { sha: 'ccc3333', subject: null, sessionId: 's2', committedAt: 9_000 },
        // Another session's commit is never borrowed.
        { sha: 'ddd4444', subject: null, sessionId: 's9', committedAt: 2_100 },
      ],
    });
    expect(entries[0].provenance.commit?.sha).toBe('bbb2222');
  });
});

describe('pinCanvasRevisionCard', () => {
  function board(): CanvasDocument {
    return {
      nodes: [
        {
          id: 'card-1',
          type: 'link',
          x: 0,
          y: 0,
          width: 400,
          height: 300,
          url: 'nimbalyst://doc/org-1/doc-1',
          [NIMBALYST_CANVAS_NAMESPACE]: {
            label: 'Login',
            reference: { kind: 'doc', uri: 'nimbalyst://doc/org-1/doc-1' },
          },
        },
      ],
      edges: [],
    };
  }

  it('adds a pinned card beside the source and leaves the source untouched', () => {
    const before = board();
    const after = pinCanvasRevisionCard(before, {
      sourceNodeId: 'card-1',
      revisionId: 'rev-7',
      sequence: 7,
    });

    expect(after.nodes).toHaveLength(2);
    // The source is the same object: pinning is additive, never a rewrite.
    expect(after.nodes?.[0]).toBe(before.nodes?.[0]);

    const pinned = after.nodes?.[1];
    expect(pinned?.x).toBe(424);
    expect(pinned?.y).toBe(0);
    expect(pinned?.[NIMBALYST_CANVAS_NAMESPACE]).toMatchObject({
      label: 'Login v7',
      reference: {
        kind: 'doc',
        uri: 'nimbalyst://doc/org-1/doc-1',
        revisionId: 'rev-7',
      },
    });
    expect(resolveCanvasCardRevision(
      (pinned?.[NIMBALYST_CANVAS_NAMESPACE] as { reference: never }).reference
    )).toEqual({ revisionId: 'rev-7', pinned: true });
  });

  it('steps past an occupied slot rather than stacking on a neighbour', () => {
    const crowded = board();
    crowded.nodes?.push({
      id: 'card-2',
      type: 'text',
      x: 424,
      y: 0,
      width: 400,
      height: 300,
      text: 'in the way',
    });
    const after = pinCanvasRevisionCard(crowded, {
      sourceNodeId: 'card-1',
      revisionId: 'rev-7',
    });
    expect(after.nodes?.at(-1)?.x).toBe(848);
  });

  it('refuses a card with no shared document to pin against', () => {
    const local: CanvasDocument = {
      nodes: [
        {
          id: 'card-1',
          type: 'file',
          x: 0,
          y: 0,
          width: 400,
          height: 300,
          file: 'notes/private.md',
        },
      ],
      edges: [],
    };
    expect(
      pinCanvasRevisionCard(local, {
        sourceNodeId: 'card-1',
        revisionId: 'rev-7',
      })
    ).toBe(local);
    expect(
      pinCanvasRevisionCard(board(), {
        sourceNodeId: 'missing',
        revisionId: 'rev-7',
      }).nodes
    ).toHaveLength(1);
  });
});
