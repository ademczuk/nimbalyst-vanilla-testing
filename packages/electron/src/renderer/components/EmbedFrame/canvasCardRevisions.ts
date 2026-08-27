/**
 * The desktop implementation of the canvas's `revisions` slot.
 *
 * Two sources, joined by a pure function that lives in the runtime:
 *
 * - **The room** knows a revision exists, when it was captured, and which
 *   member captured it. That is `CollabHistoryClient.listRevisions`, the same
 *   REST client the history dialog uses, over the same document room.
 * - **This machine** knows which session produced the content, what it was
 *   asked to do, and which commit shipped it. That is
 *   `canvas:revision-provenance`, one IPC call reading `session_files`,
 *   `ai_transcript_events` and `session_commits`.
 *
 * `assembleCanvasRevisions` decides which local edit belongs to which revision.
 * That rule is the part worth getting right and it is deliberately not here --
 * it is pure, it is tested, and the web console will want the same rule the
 * moment it can answer the same questions.
 *
 * ## What this can and cannot attribute
 *
 * The local half is keyed by a **workspace file path**, so a `file` card gets
 * full provenance and a card that names only a shared document gets its author
 * and nothing else. There is no doc-id -> local-path mapping in the shared
 * document index to key on, and inventing one by title would attribute a
 * session's work to whichever local file happened to share a name. Author-only
 * provenance is the honest answer until that mapping exists; it renders as an
 * entry with a "By" line and no session, which is exactly what it means.
 */

import { CollabHistoryClient } from '@nimbalyst/runtime/sync';
import type { DocRevisionMetadata } from '@nimbalyst/collab-protocol';
import {
  assembleCanvasRevisions,
  canvasCardDocumentUri,
  type CanvasCardReference,
  type CanvasRevisionEntry,
  type CanvasRevisionSource,
} from '@nimbalyst/runtime/canvas';
import { store } from '@nimbalyst/runtime/store';

import { parseCanvasDocumentReference } from './canvasDocumentReference';
import { resolveDesktopCollabConfigForUri } from '../../utils/collabDocumentOpener';
import { getTeamSyncProviderForScopeKey } from '../../store/atoms/collabDocuments';
import { activeWorkspacePathAtom } from '../../store/atoms/openProjects';
import { teamMemberDisplayName } from '../../utils/teamMemberDisplayName';

/** One page is plenty for a rail; a card with hundreds of revisions is a list. */
const REVISION_PAGE_LIMIT = 50;

interface ProvenanceResponse {
  success: boolean;
  edits: {
    sessionId: string;
    sessionName: string | null;
    editedAt: number;
    prompt: string | null;
  }[];
  commits: {
    sha: string;
    subject: string | null;
    sessionId: string;
    committedAt: number;
  }[];
}

function displayNamesFor(workspacePath: string): ReadonlyMap<string, string> {
  const members =
    getTeamSyncProviderForScopeKey(workspacePath)?.getTeamState()?.members ?? [];
  return new Map(
    members.map((member) => [member.userId, teamMemberDisplayName(member)]),
  );
}

/**
 * The local file this card's content lives in, or null.
 *
 * A `file` card names it directly, including one that has been shared -- the
 * `sharedAs` binding adds a room, it does not remove the file.
 */
function localFilePath(reference: CanvasCardReference): string | null {
  return reference.kind === 'file' ? reference.path : null;
}

async function localProvenance(
  workspacePath: string,
  filePath: string | null,
): Promise<ProvenanceResponse> {
  if (filePath === null) return { success: true, edits: [], commits: [] };
  const result = (await window.electronAPI.invoke(
    'canvas:revision-provenance',
    workspacePath,
    filePath,
  )) as ProvenanceResponse | undefined;
  return result ?? { success: false, edits: [], commits: [] };
}

export const canvasCardRevisions: CanvasRevisionSource = {
  async list(
    reference: CanvasCardReference,
  ): Promise<readonly CanvasRevisionEntry[]> {
    const uri = canvasCardDocumentUri(reference);
    if (uri === null) return [];
    const parsed = parseCanvasDocumentReference(uri);
    if (!parsed) return [];

    const workspacePath = store.get(activeWorkspacePathAtom);
    if (!workspacePath) return [];

    const config = await resolveDesktopCollabConfigForUri(
      workspacePath,
      uri,
      parsed.documentId,
    );
    if (!config) return [];

    const client = new CollabHistoryClient({
      serverUrl: config.serverUrl,
      getJwt: config.getJwt,
      urlExtraQuery: config.urlExtraQuery,
      orgId: parsed.orgId,
      documentId: parsed.documentId,
    });

    // The room call and the local join are independent; a slow DB lane should
    // not delay the list, and a failing one should not lose it.
    const [listed, provenance] = await Promise.all([
      client.listRevisions({ limit: REVISION_PAGE_LIMIT }),
      localProvenance(workspacePath, localFilePath(reference)).catch(() => ({
        success: false,
        edits: [],
        commits: [],
      })),
    ]);

    return assembleCanvasRevisions(
      (listed.revisions ?? []).map((revision: DocRevisionMetadata) => ({
        revisionId: revision.revisionId,
        createdAt: revision.createdAt,
        createdBy: revision.createdBy,
        revisionKind: revision.revisionKind,
        editorType: revision.editorType,
      })),
      {
        displayNames: displayNamesFor(workspacePath),
        edits: provenance.edits,
        commits: provenance.commits,
      },
    );
  },
};
