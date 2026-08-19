// @vitest-environment node
/**
 * `MockupBinding` is the real write path for a shared mockup and had no tests.
 * It does not own the document: the editor holds the HTML in a ref and the
 * binding diffs that shadow copy into `Y.Text`. Everything that can go wrong
 * lives in the gap between those two, so these drive real `Y.Doc`s with a
 * buffered link between them rather than mocking either side.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { COLLAB_INIT_ORIGIN } from '@nimbalyst/extension-sdk';
import { MockupBinding } from '../mockupBinding';
import { getYMockupText, seedMockupYDoc } from '../seed';

const SEED = [
  '<!DOCTYPE html>',
  '<html>',
  '<body>',
  '  <h1>Shared mockup</h1>',
  '</body>',
  '</html>',
].join('\n');

const REMOTE = Symbol('test-remote');

/** An editor + binding pair whose `contentRef` is a plain string. */
function makeClient(yDoc: Y.Doc) {
  const client = {
    shadow: getYMockupText(yDoc).toString(),
    binding: null as unknown as MockupBinding,
    remoteCount: 0,
  };
  client.binding = new MockupBinding(yDoc, client.shadow, {
    getCurrentHtml: () => client.shadow,
    onRemoteContent: (content) => {
      client.remoteCount++;
      // Exactly what MockupEditor does: adopt the merged text, then tell the
      // binding this is the new baseline.
      client.shadow = content;
      client.binding.noteAppliedRemote(content);
    },
  });
  return client;
}

/**
 * Two docs with a manually-pumped link. Buffering is the point: delivering
 * each update instantly would serialise the clients and never produce the
 * concurrent case this file exists to cover.
 */
function makeLink(docA: Y.Doc, docB: Y.Doc) {
  const toB: Uint8Array[] = [];
  const toA: Uint8Array[] = [];
  docA.on('update', (update, origin) => {
    if (origin !== REMOTE) toB.push(update);
  });
  docB.on('update', (update, origin) => {
    if (origin !== REMOTE) toA.push(update);
  });
  return () => {
    const a = toB.splice(0);
    const b = toA.splice(0);
    for (const update of a) Y.applyUpdate(docB, update, REMOTE);
    for (const update of b) Y.applyUpdate(docA, update, REMOTE);
  };
}

function setUp() {
  const docA = new Y.Doc();
  seedMockupYDoc(docA, SEED);
  const docB = new Y.Doc();
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
  const flush = makeLink(docA, docB);
  return { docA, docB, flush, a: makeClient(docA), b: makeClient(docB) };
}

describe('MockupBinding convergence', () => {
  it('keeps both clients edits when they append at the same offset', () => {
    const { docA, docB, flush, a, b } = setUp();

    a.shadow = `${a.shadow}\n<!-- Alpha -->`;
    a.binding.syncNow();
    b.shadow = `${b.shadow}\n<!-- Bravo -->`;
    b.binding.syncNow();

    flush();

    expect(getYMockupText(docA).toString()).toContain('<!-- Alpha -->');
    expect(getYMockupText(docA).toString()).toContain('<!-- Bravo -->');
    expect(getYMockupText(docA).toString()).toBe(getYMockupText(docB).toString());
    // Both editors must be showing the merged text, not just the doc.
    expect(a.shadow).toBe(getYMockupText(docA).toString());
    expect(b.shadow).toBe(a.shadow);
  });

  it('re-baselines on a remote update so the next sync is a no-op', () => {
    const { docA, flush, a, b } = setUp();

    b.shadow = `${b.shadow}\n<!-- Bravo -->`;
    b.binding.syncNow();
    flush();

    expect(a.remoteCount).toBe(1);
    const afterMerge = getYMockupText(docA).toString();
    // A has typed nothing since adopting the merge. Without `noteAppliedRemote`
    // the diff would run against A's pre-merge baseline and delete Bravo.
    a.binding.syncNow();
    expect(getYMockupText(docA).toString()).toBe(afterMerge);
  });

  it('paints a bootstrap replay that arrives after the binding is constructed', () => {
    // Reopening a durable offline replica replays the whole document under
    // COLLAB_INIT_ORIGIN, and the binding is built against the empty seed
    // before that replay lands. Filtering bootstrap-origin transactions left
    // the editor blank; the `lastSyncedContent` check is what suppresses the
    // benign case (a bootstrap identical to what the editor already shows).
    const replica = new Y.Doc();
    const client = {
      shadow: '',
      binding: null as unknown as MockupBinding,
      remoteCount: 0,
    };
    client.binding = new MockupBinding(replica, '', {
      getCurrentHtml: () => client.shadow,
      onRemoteContent: (content) => {
        client.remoteCount++;
        client.shadow = content;
        client.binding.noteAppliedRemote(content);
      },
    });

    const source = new Y.Doc();
    seedMockupYDoc(source, SEED);
    Y.applyUpdate(replica, Y.encodeStateAsUpdate(source), COLLAB_INIT_ORIGIN);

    expect(client.shadow).toBe(SEED);
    expect(client.remoteCount).toBe(1);
  });

  it('sends only the changed range, not the whole document', () => {
    const { docA, a } = setUp();
    const deltas: unknown[] = [];
    getYMockupText(docA).observe((event) => deltas.push(event.delta));

    a.shadow = a.shadow.replace('Shared mockup', 'Renamed mockup');
    a.binding.syncNow();

    // One retain/delete/insert triple. A whole-document replace would show a
    // delete the length of the seed instead. The delete is "Shar" and not
    // "Shared" because the common-suffix shortcut keeps the shared trailing
    // "ed" -- concurrent edits elsewhere in the line survive as a result.
    expect(deltas).toEqual([
      [{ retain: SEED.indexOf('Shared') }, { delete: 4 }, { insert: 'Renam' }],
    ]);
  });
});
