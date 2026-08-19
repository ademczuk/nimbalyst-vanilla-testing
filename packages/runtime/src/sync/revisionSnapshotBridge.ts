/**
 * RevisionSnapshotAdapter <- CollabContentAdapter bridge.
 *
 * The extension SDK has a small per-tab `RevisionSnapshotAdapter`
 * registered at editor-mount time. The generic
 * `CollabContentAdapter` registry can fully express the same
 * contract (and more), so the host can synthesise a tab adapter on
 * demand for any document type that has a registered content
 * adapter.
 *
 * Editors that want fine-grained control (custom snapshot format,
 * async restore) still register their own RevisionSnapshotAdapter
 * directly; this bridge is the default path for editors that don't.
 */
import { Doc } from 'yjs';
import {
  getCollabContentAdapter,
  getRevisionSnapshotFns,
} from '@nimbalyst/collab-adapters';
import type { RevisionSnapshotAdapter } from '@nimbalyst/extension-sdk';

type RevisionPreviewKind = NonNullable<RevisionSnapshotAdapter['previewKind']>;

export interface CollabAdapterRevisionBridgeOptions {
  documentType: string;
  getYDoc: () => Doc | null;
  /** Override the snapshot format identifier. Defaults to the
   *  adapter's documentType. */
  contentFormat?: string;
  /** Override the preview kind. Defaults to 'text' (matches the
   *  toPlainText projection the dialog can render). */
  previewKind?: RevisionPreviewKind;
}

/**
 * Render a stored revision as text for the history dialog.
 *
 * A revision's bytes are opaque -- with the default adapter they are a Y
 * state update, and an adapter with a custom snapshot format can make them
 * anything. Rather than special-casing formats, materialize the snapshot
 * into a scratch document using the adapter's own restore path (whose whole
 * job is "make this doc hold that snapshot's content"), then project it with
 * `toPlainText`.
 *
 * Returns null when the document type has no registered adapter, which is
 * the `previewKind: 'metadata-only'` case.
 */
export function previewRevisionSnapshot(
  documentType: string,
  bytes: Uint8Array,
): string | null {
  const adapter = getCollabContentAdapter(documentType);
  if (!adapter) return null;

  const { restoreRevisionSnapshot } = getRevisionSnapshotFns(adapter);
  const scratch = new Doc();
  try {
    restoreRevisionSnapshot(scratch, bytes);
    return adapter.toPlainText(scratch);
  } finally {
    scratch.destroy();
  }
}

export function createRevisionAdapterFromCollabContent(
  options: CollabAdapterRevisionBridgeOptions,
): RevisionSnapshotAdapter | null {
  const adapter = getCollabContentAdapter(options.documentType);
  if (!adapter) return null;

  const { exportRevisionSnapshot, restoreRevisionSnapshot } =
    getRevisionSnapshotFns(adapter);

  return {
    contentFormat: options.contentFormat ?? adapter.documentType,
    previewKind: options.previewKind ?? 'text',
    exportRevisionSnapshot() {
      const yDoc = options.getYDoc();
      if (!yDoc) {
        throw new Error(
          `[revisionSnapshotBridge] Y.Doc unavailable for documentType=${options.documentType}`,
        );
      }
      return exportRevisionSnapshot(yDoc);
    },
    restoreRevisionSnapshot(plaintext: Uint8Array) {
      const yDoc = options.getYDoc();
      if (!yDoc) {
        throw new Error(
          `[revisionSnapshotBridge] Y.Doc unavailable for documentType=${options.documentType}`,
        );
      }
      restoreRevisionSnapshot(yDoc, plaintext);
    },
  };
}
