/**
 * agentDocumentAccess
 *
 * The one place that answers "how does an agent reach this document?".
 *
 * A target is either a markdown file on disk or a collab:// shared document,
 * and a shared document is reachable either through a mounted editor or
 * headlessly through the room. Before NIM-3754 this decision was made
 * independently in three places -- `useIPCHandlers`' applyDiff and readCollabDoc
 * listeners, and a near-verbatim copy of the applyDiff listener in `aiApi` --
 * and every copy made the same wrong call: refuse unless an editor happens to be
 * mounted. An agent handed a teammate's doc link could not read or edit it until
 * a human opened the tab.
 *
 * Mounted wins when present: it is the state the user is actually looking at,
 * and it avoids putting a second peer in the room. Headless is the fallback,
 * not a degraded path.
 */
import type { TextReplacement } from '@nimbalyst/runtime';
import { editorRegistry } from '@nimbalyst/runtime/ai/EditorRegistry';
import { isCollabUri } from '@nimbalyst/collab-protocol';

import {
  HeadlessCollabDocumentError,
  readHeadlessCollabDocContent,
} from './HeadlessCollabDocument';
import {
  applyHeadlessCollabDocEdit,
  type CollabDocAgentIdentity,
} from './HeadlessCollabDocEdit';

export type CollabDocAccessRoute = 'mounted' | 'headless';

export interface CollabDocReadResult {
  content: string;
  route: CollabDocAccessRoute;
}

export interface AgentDiffResult {
  success: boolean;
  error?: string;
  code?: string;
}

export interface AgentDiffOptions {
  workspacePath?: string | null;
  /** Surfaced to other collaborators as a participant during a headless edit. */
  agent?: CollabDocAgentIdentity;
  /** Correlates the mounted editor's async completion event with this request. */
  requestId?: string;
}

/**
 * Read a shared document's current content, whether or not it is open.
 *
 * Throws rather than returning empty content when the room cannot be reached --
 * see the header on `HeadlessCollabDocument` for why '' is the dangerous answer.
 */
export async function readCollabDocForAgent(
  documentUri: string,
  workspacePath: string | null | undefined,
): Promise<CollabDocReadResult> {
  if (editorRegistry.has(documentUri)) {
    return { content: editorRegistry.getContent(documentUri), route: 'mounted' };
  }
  if (!workspacePath) {
    throw new HeadlessCollabDocumentError(
      'DOCUMENT_NOT_AVAILABLE',
      `No workspace is available to open the shared document ${documentUri}.`,
    );
  }
  return {
    content: await readHeadlessCollabDocContent(documentUri, workspacePath),
    route: 'headless',
  };
}

/**
 * Apply an agent's replacements to a markdown file or a shared document.
 *
 * Returns a result rather than throwing, because both callers report the
 * outcome back over an IPC result channel and a thrown error there is just a
 * less specific failure message.
 */
export async function applyAgentDiff(
  targetFilePath: string,
  replacements: TextReplacement[],
  options: AgentDiffOptions = {},
): Promise<AgentDiffResult> {
  const isCollab = isCollabUri(targetFilePath);
  if (!isCollab && !targetFilePath.endsWith('.md')) {
    return {
      success: false,
      error: `applyDiff can only modify markdown files (.md) or collaborative documents (collab:// URIs). Attempted to modify: ${targetFilePath}`,
    };
  }

  if (isCollab && !editorRegistry.has(targetFilePath)) {
    if (!options.workspacePath) {
      return {
        success: false,
        code: 'DOCUMENT_NOT_AVAILABLE',
        error: `No workspace is available to open the shared document ${targetFilePath}.`,
      };
    }
    try {
      await applyHeadlessCollabDocEdit(
        targetFilePath,
        options.workspacePath,
        replacements,
        options.agent ? { agent: options.agent } : {},
      );
      return { success: true };
    } catch (error) {
      return {
        success: false,
        ...(error instanceof HeadlessCollabDocumentError
          ? { code: error.code }
          : {}),
        error:
          error instanceof Error
            ? error.message
            : 'Unknown error editing collab document',
      };
    }
  }

  // A markdown file that is not open can simply be opened behind the scenes;
  // a collab document reaching here is already mounted.
  if (!editorRegistry.has(targetFilePath)) {
    const result = await window.electronAPI.readFileContent(targetFilePath);
    await editorRegistry.openFileInBackground(
      targetFilePath,
      result?.success ? result.content : '',
    );
  }

  const result = await editorRegistry.applyReplacements(
    targetFilePath,
    replacements,
    options.requestId,
  );
  return result ?? {
    success: false,
    error: 'No result returned from diff application',
  };
}
