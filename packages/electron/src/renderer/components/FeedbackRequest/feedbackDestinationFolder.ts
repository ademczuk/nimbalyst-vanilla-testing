/**
 * Turning a compose-time destination into a real folder id.
 *
 * The draft can carry three things, and all three end up here:
 *
 * - **Nothing.** The author never opened the picker, which is the common case.
 *   The request goes to a workspace-level `Feedback requests` folder rather
 *   than to `lastSharedFolderId`, because that value remembers an unrelated
 *   action -- share one spec into `Product/` and every mockup an agent asks
 *   about afterwards follows it there, which nobody chose.
 * - **A folder id.** Use it, unless the team deleted it since the picker
 *   painted, in which case fall back to the root rather than failing the send.
 * - **A pending folder.** A name the author typed that does not exist yet.
 *
 * `resolve` never creates anything. `create` is a separate call the send path
 * makes only once it is actually going to publish, so an abandoned send leaves
 * the team without an empty folder in it. That ordering is the whole reason
 * these are two functions.
 *
 * What this does NOT fix: a folder is not a hiding place. Nothing in the app
 * treats any folder as system-owned or non-browsable, and Shared Docs Home
 * lists documents straight off the index without consulting the tree at all.
 * So this tidies the tree and leaves the flat list exactly as it was. Making
 * these documents genuinely out of the way needs an origin marker on the index
 * entry, which is a schema change and deliberately not attempted here.
 */

import type { CollabScope } from '@nimbalyst/collab-client/core';
import {
  createSharedFolder,
  getSharedFoldersForScope,
  refreshSharedFolders,
  type SharedFolder,
} from '../../store/atoms/collabDocuments';
import { FEEDBACK_DEFAULT_DESTINATION_NAME } from '@nimbalyst/runtime/ui/AgentTranscript/components/CustomToolWidgets/feedback/feedbackComposeDraft';
import type { FeedbackComposeDestination } from '@nimbalyst/runtime/ui/AgentTranscript/components/CustomToolWidgets/InteractiveWidgetHost';

export interface ResolvedFeedbackDestination {
  /** Null is the team-files root, and is also the fallback for a stale id. */
  folderId: string | null;
  folderPath: string;
  /** Still has to be created before anything can be published into it. */
  pendingFolder?: { name: string; parentFolderId: string | null };
}

export interface FeedbackDestinationDeps {
  listFolders(scope: CollabScope): Promise<SharedFolder[]>;
  createFolder(
    scope: CollabScope,
    name: string,
    parentFolderId: string | null,
  ): Promise<string>;
}

const defaultDeps: FeedbackDestinationDeps = {
  // Refresh first: a folder index that is minutes stale can place a document
  // in a folder the team has already deleted.
  listFolders: async (scope) => {
    await refreshSharedFolders(scope);
    return getSharedFoldersForScope(scope);
  },
  createFolder: (scope, name, parentFolderId) =>
    createSharedFolder(scope, name, parentFolderId),
};

function folderPathOf(folders: SharedFolder[], folderId: string | null): string {
  if (!folderId) return '';
  const segments: string[] = [];
  const seen = new Set<string>();
  let cursor = folders.find((folder) => folder.folderId === folderId);
  while (cursor && !seen.has(cursor.folderId)) {
    seen.add(cursor.folderId);
    segments.unshift(cursor.name);
    cursor = cursor.parentFolderId
      ? folders.find((folder) => folder.folderId === cursor!.parentFolderId)
      : undefined;
  }
  return segments.join('/');
}

export async function resolveFeedbackDestination(
  scope: CollabScope,
  destination: FeedbackComposeDestination | undefined,
  deps: FeedbackDestinationDeps = defaultDeps,
): Promise<ResolvedFeedbackDestination> {
  const folders = await deps.listFolders(scope);

  if (destination?.pendingFolder) {
    // The author may have typed a name that has since appeared, or that they
    // typed twice; reuse rather than creating a duplicate sibling.
    const parentId = destination.pendingFolder.parentFolderId;
    const existing = folders.find(
      (folder) =>
        folder.name === destination.pendingFolder!.name &&
        (folder.parentFolderId ?? null) === parentId,
    );
    if (existing) {
      return { folderId: existing.folderId, folderPath: folderPathOf(folders, existing.folderId) };
    }
    return {
      folderId: parentId,
      folderPath: folderPathOf(folders, parentId),
      pendingFolder: destination.pendingFolder,
    };
  }

  if (destination) {
    const exists = destination.folderId
      && folders.some((folder) => folder.folderId === destination.folderId);
    // A folder deleted between picking and sending is not a reason to refuse
    // the whole request; the root is where an unplaced document already goes.
    const folderId = exists ? destination.folderId : null;
    return { folderId, folderPath: folderPathOf(folders, folderId) };
  }

  const existingDefault = folders.find(
    (folder) =>
      folder.name === FEEDBACK_DEFAULT_DESTINATION_NAME &&
      (folder.parentFolderId ?? null) === null,
  );
  if (existingDefault) {
    return {
      folderId: existingDefault.folderId,
      folderPath: FEEDBACK_DEFAULT_DESTINATION_NAME,
    };
  }
  return {
    folderId: null,
    folderPath: '',
    pendingFolder: { name: FEEDBACK_DEFAULT_DESTINATION_NAME, parentFolderId: null },
  };
}

/**
 * Create the pending folder, if there is one. Called once, after every author
 * question is answered and immediately before the first document is published.
 */
export async function createPendingFeedbackFolder(
  scope: CollabScope,
  resolved: ResolvedFeedbackDestination,
  deps: FeedbackDestinationDeps = defaultDeps,
): Promise<ResolvedFeedbackDestination> {
  if (!resolved.pendingFolder) return resolved;
  const { name, parentFolderId } = resolved.pendingFolder;
  const folderId = await deps.createFolder(scope, name, parentFolderId);
  return {
    folderId,
    folderPath: resolved.folderPath ? `${resolved.folderPath}/${name}` : name,
  };
}
