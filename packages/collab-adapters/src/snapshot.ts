/**
 * Default snapshot helpers.
 *
 * Adapters that don't supply their own `exportRevisionSnapshot` /
 * `restoreRevisionSnapshot` get this pair. Export is a Y state
 * update, which round-trips any Y.Doc faithfully but is opaque (no
 * diffing across versions). Adapters with a denser textual or
 * structural snapshot format override these.
 */
import { Doc, encodeStateAsUpdateV2, applyUpdateV2, applyUpdate } from 'yjs';
import type { CollabContentAdapter } from './CollabContentAdapter';

export function defaultExportRevisionSnapshot(yDoc: Doc): Uint8Array {
  return encodeStateAsUpdateV2(yDoc);
}

/**
 * Decode revision bytes into a fresh document.
 *
 * Current snapshots are `encodeStateAsUpdateV2`, but stored revisions predate
 * that and some are plain V1 updates. Decoding a V1 update with the V2
 * decoder does not fail cleanly -- it walks the wrong jump table and throws
 * `contentRefs[...] is not a function` from deep inside Yjs, which surfaced
 * to users as an unreadable version.
 *
 * Each attempt gets its own Doc: a failed decode can leave partially applied
 * state behind, so a second attempt must never reuse the first one's target.
 */
export function decodeRevisionSnapshot(bytes: Uint8Array): Doc | null {
  for (const apply of [applyUpdateV2, applyUpdate]) {
    const doc = new Doc();
    try {
      apply(doc, bytes);
      return doc;
    } catch {
      doc.destroy();
    }
  }
  return null;
}

/**
 * Some stored revisions hold the document's file form (e.g. markdown text)
 * rather than a Yjs update -- the payload field is literally named
 * `plaintext`, and the format predates the Y-update snapshot. Yjs updates
 * are not generally valid UTF-8, so a strict decode is a usable
 * discriminator once both Y decoders have been ruled out.
 */
function asUtf8Text(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** First bytes as hex, so an unreadable payload can be identified on sight. */
function describeBytes(bytes: Uint8Array): string {
  const head = Array.from(bytes.slice(0, 16))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ');
  return `${bytes.byteLength} bytes, starts with ${head || '(empty)'}`;
}

/**
 * Restore is NOT `applyUpdateV2(yDoc, bytes)`. Yjs updates merge rather than
 * replace: every operation in the snapshot is already present in the live
 * doc, so applying it back is a no-op, and content deleted since the
 * snapshot stays deleted because the live delete set already covers those
 * items. That silently left the document untouched while the UI reported a
 * successful restore.
 *
 * Instead, materialize the snapshot in a scratch doc, read its content
 * through the adapter, and write that content into the live doc as NEW
 * operations. `applyFromFile` is the adapter's wipe-and-reseed entry point
 * and runs in a single transaction, so peers observe one CRDT step and
 * converge on the restored content.
 *
 * Fidelity is that of the adapter's file form: whatever `exportToFile` /
 * `applyFromFile` round-trip is what a restore preserves.
 */
export function defaultRestoreRevisionSnapshot(
  yDoc: Doc,
  bytes: Uint8Array,
  adapter: Pick<CollabContentAdapter, 'exportToFile' | 'applyFromFile'>,
): void {
  const scratch = decodeRevisionSnapshot(bytes);
  if (scratch) {
    try {
      adapter.applyFromFile(yDoc, adapter.exportToFile(scratch));
    } finally {
      scratch.destroy();
    }
    return;
  }

  const text = asUtf8Text(bytes);
  if (text !== null) {
    adapter.applyFromFile(yDoc, text);
    return;
  }

  throw new Error(
    `[collab-adapters] Revision snapshot is neither a Yjs update nor text (${describeBytes(bytes)}). ` +
      'It is most likely still encrypted at rest and was served without being decrypted.',
  );
}
