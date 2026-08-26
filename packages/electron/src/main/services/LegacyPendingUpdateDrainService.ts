/**
 * Startup drain of the legacy `collabPendingUpdates` settings field.
 *
 * Offline collab edits used to be parked in workspace settings as base64 Y.Doc
 * merges. `CollabDocumentReplicaStore` owns that now -- real tables, real
 * transactions -- and `document-sync:open` migrates an entry across when the
 * document is reopened. That trigger is the bug: blobs for documents nobody
 * reopened stayed put. One install carried 4.5MB across two documents last
 * touched two months earlier, which every settings read and write paid for
 * because `conf` rewrites the whole file on each `set`.
 *
 * This runs the same migration for every workspace without waiting for a
 * reopen. It relocates rather than deletes: an entry is only dropped once the
 * replica store confirms it committed.
 */

import { logger } from '../utils/logger';
import {
  listLegacyPendingUpdateWorkspaces,
  updateWorkspaceState,
  getWorkspaceState,
} from '../utils/store';
import { drainLegacyPendingUpdates } from '../ipc/legacyPendingUpdateDrain';
import { getCollabDocumentReplicaStore } from './CollabDocumentReplicaStore';
import { resolveCollabDocumentType } from '../ipc/collabDocumentTypeResolver';
import { getPersonalUserId, getStytchUserId } from './StytchAuthService';

let drainCompleted = false;

/** Reset between tests. */
export function __resetLegacyPendingUpdateDrainForTests(): void {
  drainCompleted = false;
}

export async function drainAllLegacyPendingUpdates(): Promise<{
  migrated: number;
  remaining: number;
  skipped?: 'already-drained' | 'no-account' | 'nothing-pending';
}> {
  if (drainCompleted) return { migrated: 0, remaining: 0, skipped: 'already-drained' };

  const workspaces = listLegacyPendingUpdateWorkspaces();
  if (workspaces.length === 0) {
    drainCompleted = true;
    return { migrated: 0, remaining: 0, skipped: 'nothing-pending' };
  }

  // The replica identity is per account. Before sign-in there is nothing to key
  // these against, so leave them alone and let the auth hook retry.
  const accountId = getPersonalUserId() ?? getStytchUserId();
  if (!accountId) {
    return { migrated: 0, remaining: workspaces.length, skipped: 'no-account' };
  }

  let migratedTotal = 0;
  let remainingTotal = 0;

  for (const { workspacePath, pending } of workspaces) {
    try {
      const workspaceState = getWorkspaceState(workspacePath);
      const { migrated, failed } = await drainLegacyPendingUpdates({
        pending,
        accountId,
        resolveDocumentType: documentId =>
          resolveCollabDocumentType({
            workspaceState: workspaceState as unknown as { openCollabDocumentEntries?: unknown },
            documentId,
          }),
        migrate: (identity, documentType, update) =>
          getCollabDocumentReplicaStore().migrateLegacyPendingUpdate(identity, documentType, update),
        onError: (key, error) =>
          logger.main.error('[LegacyPendingUpdateDrain] Could not migrate entry:', key, error),
      });

      if (migrated.length > 0) {
        updateWorkspaceState(workspacePath, state => {
          for (const key of migrated) delete state.collabPendingUpdates?.[key];
        });
      }

      migratedTotal += migrated.length;
      remainingTotal += failed.length;
    } catch (error) {
      logger.main.error('[LegacyPendingUpdateDrain] Workspace drain failed:', workspacePath, error);
      remainingTotal += Object.keys(pending).length;
    }
  }

  // Only call it done once nothing is left; otherwise a later call retries.
  if (remainingTotal === 0) drainCompleted = true;

  if (migratedTotal > 0) {
    logger.main.info(
      `[LegacyPendingUpdateDrain] Moved ${migratedTotal} legacy offline collab edit(s) into the replica store; ${remainingTotal} left behind`
    );
  }

  return { migrated: migratedTotal, remaining: remainingTotal };
}
