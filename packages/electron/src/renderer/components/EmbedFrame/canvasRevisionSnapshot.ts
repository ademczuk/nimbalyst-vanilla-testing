/**
 * Materialize one stored revision of a shared document into a detached Y.Doc.
 *
 * This is the half of pinned-revision cards that lives below React. The runtime
 * carries `revisionId` on the card's reference and refuses to let a pinned card
 * go hot; this module answers the question that makes any of that mean
 * something, which is *what content does a pinned card actually show*.
 *
 * Without it a pinned card is cosmetic. It is styled as history, locked
 * read-only, labelled "v3" -- and mounted against the live room, so it renders
 * head. Two cards pinned to two different revisions would be the same document
 * twice, with nothing on screen to say so. That is worse than not shipping the
 * feature, because the card asserts something false.
 *
 * ## Why a detached doc, and why there is still no restore
 *
 * The returned `Y.Doc` has no provider, no awareness peers, and no path back to
 * the room. It is built by the content adapter's own `restoreRevisionSnapshot`
 * into a scratch document -- the same call `previewRevisionSnapshot` makes for
 * the history dialog -- so a revision's bytes never touch the live Y.Doc.
 *
 * That is deliberate and it is the whole safety argument for Slice 5a (see the
 * header of `runtime/src/canvas/canvasRevisions.ts`, and
 * `.claude/rules/destructive-data-paths.md`). Pinning adds a card that *reads*
 * history. Nothing here writes a revision back over live content, and nothing
 * here returns a handle that could: the caller gets a document that is not
 * connected to anything, mounted into a host whose `saveContent` is a no-op.
 * Restore-over-head is a destructive path and needs the retry, verification and
 * recoverable artifact that rule requires; it is not this.
 */

import { Doc } from 'yjs';
import {
  CollabHistoryClient,
  createRevisionAdapterFromCollabContent,
} from '@nimbalyst/runtime/sync';

import {
  resolveDesktopCollabConfigForUri,
  type CollabDocumentConfig,
} from '../../utils/collabDocumentOpener';

export interface CanvasRevisionSnapshotRequest {
  workspacePath: string;
  /** The card's document URI, in either spelling the board can carry. */
  uri: string;
  orgId: string;
  documentId: string;
  revisionId: string;
  /** Picks the content adapter that knows how to read the snapshot bytes. */
  documentType: string;
}

/**
 * A refusal a card can render. Every one of these is a state the reader has to
 * be able to tell apart from "this is what v3 looked like", because each of
 * them would otherwise render as an empty document.
 */
export class CanvasRevisionSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanvasRevisionSnapshotError';
  }
}

export interface CanvasRevisionSnapshot {
  /** Holds the revision's content. Detached: no provider, no peers, no room. */
  doc: Doc;
  /**
   * The document's real collaboration config, already resolved for the history
   * fetch. Handed back so the card can build its `EditorHost` through the same
   * `createCollabExtensionHost` a live card uses, rather than inventing a
   * plausible-looking config for it.
   */
  config: CollabDocumentConfig;
}

/**
 * Load and decode one revision. The caller owns the returned doc and must
 * `destroy()` it.
 *
 * Throws `CanvasRevisionSnapshotError` for every case where the answer is
 * honestly unavailable -- no collaboration scope, a document type with no
 * registered content adapter, a payload from before the server-side encryption
 * cutover. The card shows the message; it must never show an empty editor and
 * let the reader believe the revision was blank.
 */
export async function loadCanvasRevisionSnapshot(
  request: CanvasRevisionSnapshotRequest
): Promise<CanvasRevisionSnapshot> {
  const config = await resolveDesktopCollabConfigForUri(
    request.workspacePath,
    request.uri,
    request.documentId
  );
  if (!config) {
    throw new CanvasRevisionSnapshotError(
      'This project is not connected to a team, so past revisions cannot be loaded.'
    );
  }

  const doc = new Doc();
  // Built before the fetch so a document type we cannot decode fails before we
  // spend a round trip on bytes nobody can read.
  const adapter = createRevisionAdapterFromCollabContent({
    documentType: request.documentType,
    getYDoc: () => doc,
  });
  if (!adapter) {
    doc.destroy();
    throw new CanvasRevisionSnapshotError(
      `Past revisions of ${request.documentType} documents cannot be shown yet.`
    );
  }

  try {
    const client = new CollabHistoryClient({
      serverUrl: config.serverUrl,
      getJwt: config.getJwt,
      urlExtraQuery: config.urlExtraQuery,
      orgId: request.orgId,
      documentId: request.documentId,
    });
    const revision = await client.loadRevision(request.revisionId);
    await adapter.restoreRevisionSnapshot(revision.plaintext);
  } catch (error) {
    doc.destroy();
    throw error instanceof CanvasRevisionSnapshotError
      ? error
      : new CanvasRevisionSnapshotError(
          error instanceof Error ? error.message : String(error)
        );
  }

  return { doc, config };
}
