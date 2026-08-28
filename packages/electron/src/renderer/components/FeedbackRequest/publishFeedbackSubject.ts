/**
 * Making a confirmed subject visible to the people being asked.
 *
 * A recipient may not have the project at all, so "send this for feedback"
 * implies "publish the subject as a team resource first". This module is the
 * only place that decides what publishing means per subject kind, and it is
 * deliberately separate from the compose host: the host owns ordering (confirm
 * -> ask -> publish -> create -> open), this owns the per-kind mechanics.
 *
 * Publishing is split into **ask** and **run**, and that split is the whole
 * design:
 *
 * - `prepareFeedbackSubjectPublish` gathers everything a subject needs in order
 *   to be published, including taking the author through the real share-to-team
 *   dialog for a local file. It changes nothing the team can see. A caller with
 *   three subjects can therefore collect three answers and, if the author
 *   abandons the third dialog, walk away having published nothing.
 * - The returned `run` is the side effect.
 *
 * Two more things a reader cannot see here:
 *
 * - **Publishing a file rewrites the subject ref.** A `file` ref is a path on
 *   the author's disk; it means nothing to a recipient. Once shared it becomes
 *   the created `document`, and that is the ref the request carries, so every
 *   recipient resolves the same object the author sees.
 * - **Publishing is idempotent.** A file already bound to a shared document
 *   returns that document instead of creating a second one, so a retry after a
 *   failed send does not litter the team's files with duplicates -- and does not
 *   ask the author to name it a second time.
 */

import type { ResourceRef } from '@nimbalyst/collab-protocol';

import { getFileName, joinPath, normalizePath } from '../../utils/pathUtils';

// The share-to-team flow drags the collaborative editor graph behind it. This
// module is reached from the transcript on every send, and most sends publish
// nothing, so the import is deferred to the branch that needs it. Renderer only
// -- the no-dynamic-import rule is about the Electron main process.
const loadShareToTeamFlow = () => import('../../services/shareToTeamFlow');

export type FeedbackPublishOutcome =
  | { success: true; ref?: ResourceRef }
  | { success: false; error: string };

/**
 * `blocked` covers everything that means "do not publish anything for this
 * request": an unsupported kind, an unavailable scope, and the author closing
 * the share dialog. All three are retryable, and all three leave the draft
 * intact, so the compose widget can report one message and stay sendable.
 */
export type FeedbackPublishPlan =
  | {
      status: 'ready';
      /**
       * `destination` is the folder as it exists at publish time, which is not
       * always what preparing saw: a folder the author named is only created
       * once the send is definitely going ahead. A plan that already has its
       * own answer (the author walked the share dialog) ignores it.
       */
      run: (destination?: { folderId: string | null; folderPath: string }) =>
        Promise<FeedbackPublishOutcome>;
    }
  | { status: 'blocked'; error: string };

export interface PublishFeedbackSubjectOptions {
  workspacePath: string;
  /**
   * Where this request's files go, as chosen in the compose surface. Supplying
   * it is what lets a file with nothing else to ask publish with no dialog.
   */
  destination?: { folderId: string | null; folderPath: string };
}

/**
 * Kinds that can be published at all. The compose host checks this before
 * preparing anything, so a request with one publishable and one unpublishable
 * subject refuses whole rather than walking the author through a share dialog
 * for a request that was never going to send.
 */
export function isPublishableSubjectKind(kind: ResourceRef['kind']): boolean {
  return kind === 'tracker' || kind === 'file';
}

export function unpublishableSubjectMessage(ref: ResourceRef): string {
  if (ref.kind === 'session') {
    return 'A session cannot be published, so a teammate cannot be asked to review one.';
  }
  if (ref.kind === 'document') {
    // An unshared `document` is not a local document waiting to be promoted --
    // it is an id the team's shared index does not have, so there is nothing to
    // publish. A file is the thing that becomes a shared document.
    return 'That document is not in your team files, so it cannot be shared from here.';
  }
  return `Nimbalyst cannot publish this ${ref.kind} for you yet. Share it with your team first, then send the request.`;
}

async function publishTrackerSubject(ref: ResourceRef): Promise<FeedbackPublishOutcome> {
  const result = await window.electronAPI.documentService.setTrackerItemPublished({
    itemId: ref.sourceId,
    published: true,
  });
  if (!result?.success) {
    return { success: false, error: result?.error || `${ref.sourceId} could not be published.` };
  }
  // Publishing an item under a personal-scoped tracker type sets the item's
  // bit and changes nothing anyone else can see, so main reports the effective
  // visibility rather than letting success stand in for it.
  if (result.teamVisible !== true) {
    return {
      success: false,
      error: 'This tracker item is still personal because its tracker type is personal-scoped. '
        + 'Change the tracker type sharing policy, then retry.',
    };
  }
  return { success: true };
}

/**
 * A `document` subject is either in the team's shared index already or it is
 * not a document anyone can be given -- there is no unpublished document object
 * to promote. So this verifies rather than publishes, and the compose host
 * refuses the kind up front rather than discovering it mid-publish.
 */
async function prepareDocumentSubject(ref: ResourceRef): Promise<FeedbackPublishPlan> {
  const { getSharedDocumentVisibility } = await import('../../services/mcpCollabReadHandlers');
  return getSharedDocumentVisibility(ref.sourceId).teamVisible
    ? { status: 'ready', run: async () => ({ success: true }) }
    : { status: 'blocked', error: unpublishableSubjectMessage(ref) };
}

function absoluteSubjectPath(sourceId: string, workspacePath: string): string {
  const normalized = normalizePath(sourceId);
  const isAbsolute = normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized);
  return isAbsolute ? normalized : joinPath(workspacePath, normalized);
}

function documentRef(ref: ResourceRef, orgId: string, documentId: string): ResourceRef {
  return {
    ...ref,
    orgId,
    kind: 'document',
    sourceId: documentId,
  };
}

/**
 * The author answers the shipped share dialog -- shared name, destination
 * folder, which embedded documents come along -- and nothing is created until
 * the returned `run` is called. Cancelling the dialog blocks this one subject;
 * the draft it came from is untouched.
 */
async function prepareFileSubject(
  ref: ResourceRef,
  workspacePath: string,
  destination?: { folderId: string | null; folderPath: string },
): Promise<FeedbackPublishPlan> {
  const sourceFilePath = absoluteSubjectPath(ref.sourceId, workspacePath);
  const fileName = getFileName(sourceFilePath);

  const existing = await window.electronAPI?.documentSync?.findLocalOriginLink?.(
    workspacePath,
    sourceFilePath,
  );
  if (existing?.success && existing.binding) {
    const bound = documentRef(ref, existing.binding.orgId, existing.binding.documentId);
    return { status: 'ready', run: async () => ({ success: true, ref: bound }) };
  }

  const { askShareToTeam, shareFileToTeam } = await loadShareToTeamFlow();
  const ask = await askShareToTeam(
    { filePath: sourceFilePath, fileName },
    destination ? { destination, skipWhenFullyAnswered: true } : {},
  );
  if (ask.status === 'unavailable') return { status: 'blocked', error: ask.reason };
  if (ask.status === 'cancelled') {
    return {
      status: 'blocked',
      error: `Sharing ${fileName} was cancelled, so nothing was published. `
        + 'Share it or take it out of the request, then send again.',
    };
  }

  // The dialog opening at all means the author placed this file themselves, so
  // their answer wins over the request-level folder resolved later.
  const authorChoseFolder = ask.answers.folderId !== destination?.folderId
    || ask.answers.folderPath !== destination?.folderPath;

  return {
    status: 'ready',
    run: async (resolvedDestination) => {
      const answers = !authorChoseFolder && resolvedDestination
        ? {
            ...ask.answers,
            folderId: resolvedDestination.folderId,
            folderPath: resolvedDestination.folderPath,
          }
        : ask.answers;
      const shared = await shareFileToTeam({
        filePath: sourceFilePath,
        fileName,
        answers,
        // The author is mid-compose in the transcript; the shared copy should
        // not steal the tab the results are about to open in.
        openAfterCreate: false,
        // One request, one destination: the compose host records it once after
        // the batch instead of every file overwriting the last.
        persistLastSharedFolder: false,
      });
      return shared.status === 'shared'
        ? { success: true, ref: documentRef(ref, shared.orgId, shared.documentId) }
        : { success: false, error: shared.error };
    },
  };
}

export async function prepareFeedbackSubjectPublish(
  ref: ResourceRef,
  options: PublishFeedbackSubjectOptions,
): Promise<FeedbackPublishPlan> {
  if (ref.kind === 'tracker') {
    return { status: 'ready', run: () => publishTrackerSubject(ref) };
  }
  if (ref.kind === 'document') return prepareDocumentSubject(ref);
  if (ref.kind === 'file') {
    return prepareFileSubject(ref, options.workspacePath, options.destination);
  }
  return { status: 'blocked', error: unpublishableSubjectMessage(ref) };
}

/** Ask and publish in one step, for a caller with a single subject. */
export async function publishFeedbackSubject(
  ref: ResourceRef,
  options: PublishFeedbackSubjectOptions,
): Promise<FeedbackPublishOutcome> {
  const plan = await prepareFeedbackSubjectPublish(ref, options);
  return plan.status === 'ready'
    ? plan.run(options.destination)
    : { success: false, error: plan.error };
}
