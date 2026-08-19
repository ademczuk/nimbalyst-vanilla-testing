// @vitest-environment node
/**
 * Revision restore has to actually revert.
 *
 * The original default applied the stored snapshot with `applyUpdateV2`,
 * which MERGES CRDT state rather than replacing it: every operation in the
 * snapshot is already present in the live doc, so the apply is a no-op and
 * "Restore as Current Version" silently left the document untouched while
 * still writing a `restore-head` revision claiming success. No adapter
 * overrides these functions, so every shared document was affected.
 *
 * Restore must instead express the old content as NEW operations on the live
 * doc, so peers converge on it.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { getRevisionSnapshotFns } from '../registry';
import type { CollabContentAdapter } from '../CollabContentAdapter';

/**
 * Minimal adapter over a single Y.Text. Mirrors the contract the markdown
 * adapter implements (`applyFromFile` = wipe and reseed in one transaction)
 * without dragging Lexical into this package's tests.
 */
const textAdapter: CollabContentAdapter = {
  documentType: 'test-text',
  fileExtensions: ['.txt'],
  layoutVersion: 1,
  isEmpty: (doc) => doc.getText('text').length === 0,
  seedFromFile: (doc, source) => {
    doc.getText('text').insert(0, String(source));
  },
  applyFromFile: (doc, source) => {
    doc.transact(() => {
      const text = doc.getText('text');
      text.delete(0, text.length);
      text.insert(0, String(source));
    });
  },
  exportToFile: (doc) => doc.getText('text').toString(),
  toPlainText: (doc) => doc.getText('text').toString(),
};

function read(doc: Y.Doc): string {
  return doc.getText('text').toString();
}

describe('default revision snapshot restore', () => {
  it('reverts the live document to the snapshot content', () => {
    const { exportRevisionSnapshot, restoreRevisionSnapshot } =
      getRevisionSnapshotFns(textAdapter);

    const live = new Y.Doc();
    textAdapter.seedFromFile(live, 'version one');
    const snapshot = exportRevisionSnapshot(live);

    textAdapter.applyFromFile(live, 'version two, quite different');
    expect(read(live)).toBe('version two, quite different');

    restoreRevisionSnapshot(live, snapshot);

    expect(read(live)).toBe('version one');
  });

  it('propagates the revert to a connected peer', () => {
    // A merge-style restore produces no update at all, so a peer would never
    // learn the document was rolled back.
    const { exportRevisionSnapshot, restoreRevisionSnapshot } =
      getRevisionSnapshotFns(textAdapter);

    const live = new Y.Doc();
    const peer = new Y.Doc();
    live.on('update', (u, origin) => {
      if (origin !== 'remote') Y.applyUpdate(peer, u, 'remote');
    });

    textAdapter.seedFromFile(live, 'version one');
    const snapshot = exportRevisionSnapshot(live);
    textAdapter.applyFromFile(live, 'version two');
    expect(read(peer)).toBe('version two');

    restoreRevisionSnapshot(live, snapshot);

    expect(read(peer)).toBe('version one');
  });

  it('reads a legacy V1-encoded snapshot', () => {
    // Stored revisions predate the V2 default. Decoding one of those with the
    // V2 decoder throws `contentRefs[...] is not a function` from inside Yjs,
    // which reached users as an unreadable version.
    const { restoreRevisionSnapshot } = getRevisionSnapshotFns(textAdapter);

    const source = new Y.Doc();
    textAdapter.seedFromFile(source, 'encoded the old way');
    const legacySnapshot = Y.encodeStateAsUpdate(source);

    const live = new Y.Doc();
    textAdapter.seedFromFile(live, 'current content');
    restoreRevisionSnapshot(live, legacySnapshot);

    expect(read(live)).toBe('encoded the old way');
  });

  it('reads a revision stored as the document file form rather than a Yjs update', () => {
    // The payload field is named `plaintext` and older revisions stored the
    // document's text, not a Y update.
    const { restoreRevisionSnapshot } = getRevisionSnapshotFns(textAdapter);

    const live = new Y.Doc();
    textAdapter.seedFromFile(live, 'current content');
    restoreRevisionSnapshot(live, new TextEncoder().encode('stored as text'));

    expect(read(live)).toBe('stored as text');
  });

  it('describes bytes that are neither a Yjs update nor text', () => {
    const { restoreRevisionSnapshot } = getRevisionSnapshotFns(textAdapter);
    const live = new Y.Doc();
    // Invalid UTF-8 (lone continuation bytes) that is also not a Y update.
    const opaque = new Uint8Array([0x9f, 0x8a, 0xff, 0xfe, 0x80, 0x81]);

    expect(() => restoreRevisionSnapshot(live, opaque)).toThrow(
      /neither a Yjs update nor text \(6 bytes, starts with 9f 8a ff fe 80 81\)/,
    );
  });

  it('restores content that was deleted after the snapshot was taken', () => {
    // The hardest case for a CRDT merge: the live doc's delete set already
    // covers the snapshot's inserts, so re-applying them resurrects nothing.
    const { exportRevisionSnapshot, restoreRevisionSnapshot } =
      getRevisionSnapshotFns(textAdapter);

    const live = new Y.Doc();
    textAdapter.seedFromFile(live, 'keep this paragraph');
    const snapshot = exportRevisionSnapshot(live);

    textAdapter.applyFromFile(live, '');
    expect(read(live)).toBe('');

    restoreRevisionSnapshot(live, snapshot);

    expect(read(live)).toBe('keep this paragraph');
  });
});
