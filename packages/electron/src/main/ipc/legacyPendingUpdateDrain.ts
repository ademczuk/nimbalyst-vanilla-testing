/**
 * Drain of the legacy `collabPendingUpdates` bag in workspace settings.
 *
 * Offline collab edits used to be parked in `WorkspaceState.collabPendingUpdates`
 * as base64 Y.Doc merges. `CollabDocumentReplicaStore` owns that job now, and
 * `document-sync:open` migrates an entry across -- but only for the one document
 * being opened, so entries for documents the user never reopens sit in
 * `workspace-settings.json` forever. Three such entries had grown to 4.5MB and
 * were 63-170 days old, and because `conf` re-reads and re-parses the whole file
 * on every `.get()`, every workspace-state read in the main process paid for them.
 *
 * These blobs are unsynced user edits, so this drain never deletes: it hands each
 * entry to the same `migrateLegacyPendingUpdate` the open path uses, and only
 * reports a key as drained once the replica store has committed it. Anything that
 * fails or throws stays exactly where it is.
 */

export interface LegacyPendingUpdateEntry {
  mergedUpdateBase64: string;
  updatedAt: number;
}

export interface LegacyReplicaIdentity {
  accountId: string;
  orgId: string;
  documentId: string;
}

const KEY_PREFIX = 'org:';
const KEY_SEPARATOR = ':doc:';

/**
 * `org:<orgId>:doc:<documentId>` -- the format written by `getCollabPendingKey`.
 * Parsing it means the drain needs no other state to rebuild a replica identity,
 * so entries belonging to a different org than the one being opened drain too.
 */
export function parseCollabPendingKey(
  key: string
): { orgId: string; documentId: string } | null {
  if (!key.startsWith(KEY_PREFIX)) return null;
  const separatorIndex = key.indexOf(KEY_SEPARATOR);
  if (separatorIndex <= KEY_PREFIX.length) return null;

  const orgId = key.slice(KEY_PREFIX.length, separatorIndex);
  const documentId = key.slice(separatorIndex + KEY_SEPARATOR.length);
  if (!orgId || !documentId) return null;

  return { orgId, documentId };
}

export async function drainLegacyPendingUpdates(args: {
  pending: Record<string, LegacyPendingUpdateEntry>;
  accountId: string;
  /** Document type from the persisted collab entry list, when it is known. */
  resolveDocumentType: (documentId: string) => string | undefined;
  migrate: (
    identity: LegacyReplicaIdentity,
    documentType: string,
    update: Uint8Array
  ) => Promise<boolean>;
  onError?: (key: string, error: unknown) => void;
}): Promise<{ migrated: string[]; failed: string[] }> {
  const migrated: string[] = [];
  const failed: string[] = [];

  for (const [key, entry] of Object.entries(args.pending ?? {})) {
    const parsed = parseCollabPendingKey(key);
    if (!parsed || !entry?.mergedUpdateBase64) {
      // Nothing recoverable to hand the replica store. Report it as undrained so
      // the caller leaves it alone rather than guessing at an identity for it.
      failed.push(key);
      continue;
    }

    try {
      const committed = await args.migrate(
        { accountId: args.accountId, ...parsed },
        // 'markdown' is the same fallback `document-sync:open` applies.
        args.resolveDocumentType(parsed.documentId) ?? 'markdown',
        new Uint8Array(Buffer.from(entry.mergedUpdateBase64, 'base64'))
      );
      if (committed) {
        migrated.push(key);
      } else {
        failed.push(key);
      }
    } catch (error) {
      args.onError?.(key, error);
      failed.push(key);
    }
  }

  return { migrated, failed };
}
