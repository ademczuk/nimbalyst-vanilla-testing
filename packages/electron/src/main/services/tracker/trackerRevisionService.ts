/**
 * IPC surface over `trackerItemRevisionStore` (knowledge-scopes contract 4.2).
 *
 * Its own module rather than another handler inside `ElectronDocumentService`:
 * that file is already enormous, and this is a read with one rule to keep.
 *
 * **A missing revision is an error, never the latest.** The store throws; this
 * layer turns the throw into `{ success: false, code: 'revision-not-found' }`
 * and never falls back to the current row. A citation that pins a revision and
 * silently renders a newer one is worse than one that fails, because nothing in
 * the result says the evidence moved. The renderer re-raises the coded failure
 * as `TrackerRevisionUnavailableError` so a caller cannot read it as "no data".
 */

import { safeHandle } from '../../utils/ipcRegistry';
import { getDatabase } from '../../database/initialize';
import type { AppDatabase } from '../../database/PGLiteDatabaseWorker';
import {
  getItemRevision,
  getItemRevisionByServerNumber,
  TrackerRevisionNotFoundError,
  type TrackerItemRevision,
} from './trackerItemRevisionStore';

export interface TrackerRevisionRequest {
  workspacePath: string;
  itemId: string;
  revisionId?: string;
  serverRevision?: number;
}

export type TrackerRevisionResponse =
  | { success: true; revision: TrackerItemRevision }
  | { success: false; code: 'revision-not-found' | 'invalid-request' | 'read-failed'; error: string };

/** Exported for tests: the whole decision, with no Electron or IPC in it. */
export async function readTrackerRevision(
  db: AppDatabase,
  request: TrackerRevisionRequest,
): Promise<TrackerRevisionResponse> {
  const { workspacePath, itemId, revisionId, serverRevision } = request ?? ({} as TrackerRevisionRequest);
  if (!workspacePath || !itemId) {
    return { success: false, code: 'invalid-request', error: 'workspacePath and itemId are required' };
  }
  // Exactly one addressing mode. Accepting both and preferring one would make a
  // caller that sent a mismatched pair get an answer that agrees with neither.
  const hasUuid = typeof revisionId === 'string' && revisionId.length > 0;
  const hasNumber = typeof serverRevision === 'number' && Number.isInteger(serverRevision);
  if (hasUuid === hasNumber) {
    return {
      success: false,
      code: 'invalid-request',
      error: 'Specify exactly one of revisionId or serverRevision',
    };
  }

  try {
    const revision = hasUuid
      ? await getItemRevision(db, workspacePath, itemId, revisionId!)
      : await getItemRevisionByServerNumber(db, workspacePath, itemId, serverRevision!);
    return { success: true, revision };
  } catch (error) {
    if (error instanceof TrackerRevisionNotFoundError) {
      return { success: false, code: 'revision-not-found', error: error.message };
    }
    return {
      success: false,
      code: 'read-failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

let initialized = false;

export function initTrackerRevisionService(): void {
  if (initialized) return;
  initialized = true;
  safeHandle('tracker-revision:get', async (_event, request: TrackerRevisionRequest) => {
    return readTrackerRevision(getDatabase(), request);
  });
}
