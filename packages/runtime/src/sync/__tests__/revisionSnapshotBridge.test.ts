// @vitest-environment node
/**
 * The history dialog could only ever show metadata (kind, format, truncated
 * hash) because a revision's bytes are opaque -- the default snapshot is a Y
 * state update, not text. `previewRevisionSnapshot` materializes those bytes
 * through the adapter's own restore path and projects them to text so a user
 * can see what a version actually contains before restoring it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  registerCollabContentAdapter,
  getRevisionSnapshotFns,
} from '@nimbalyst/collab-adapters';
import type { CollabContentAdapter } from '@nimbalyst/collab-adapters';
import { previewRevisionSnapshot } from '../revisionSnapshotBridge';

const textAdapter: CollabContentAdapter = {
  documentType: 'preview-test-text',
  fileExtensions: ['.previewtest'],
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

const registrations: Array<{ unregister(): void }> = [];

afterEach(() => {
  while (registrations.length) registrations.pop()!.unregister();
});

describe('previewRevisionSnapshot', () => {
  it('renders the content a revision holds, not the live content', () => {
    registrations.push(registerCollabContentAdapter(textAdapter));

    const live = new Y.Doc();
    textAdapter.seedFromFile(live, 'the version you want back');
    const snapshot = getRevisionSnapshotFns(textAdapter).exportRevisionSnapshot(live);

    // Live doc moves on; the preview must still show the stored revision.
    textAdapter.applyFromFile(live, 'something else entirely');

    expect(previewRevisionSnapshot(textAdapter.documentType, snapshot)).toBe(
      'the version you want back',
    );
  });

  it('returns null for a document type with no registered adapter', () => {
    expect(previewRevisionSnapshot('no-such-document-type', new Uint8Array())).toBeNull();
  });
});
