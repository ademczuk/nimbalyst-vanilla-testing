/**
 * The production `ResourcePreviewResolver`.
 *
 * Until this existed the seam had only a fixture behind it, so every resource
 * pill in the real app sat at `loading` and rendered the word "Loading"
 * forever. Tracker references were the exception only because
 * `MessageResourceReference` short-circuits them to a chip that reads the
 * tracker store directly -- they worked by bypassing this mechanism, not by
 * using it.
 *
 * THREE ANSWERS, NOT TWO
 *
 * "Not loaded yet", "you may not see this", and "here it is" are distinct, and
 * collapsing the first two is the failure this file is shaped to avoid. The
 * document index arrives asynchronously; a resolver that reported an
 * absent-because-unloaded document as `unavailable` would paint a permanent
 * "Unavailable" on a document the reader owns, because `useResourcePreviews`
 * re-resolves on the URN set and the resolver identity, not on a timer. So
 * `documents()` returns `null` for "no answer yet" and a list for "this is
 * everything you can see".
 *
 * REDACTION
 *
 * Nothing here decides what a degraded pill shows. `toPillView` is the single
 * redaction point, and the `unavailable` arm of `ResourcePreviewState` has no
 * title field to leak one through. This module's only obligation is to return
 * `unavailable` rather than a stale `available` when access is gone -- which it
 * gets for free by re-reading its sources on every call instead of caching.
 */

import type { ResourcePreviewResolver, ResourcePreviewState, ResourceRef } from './commentTypes';
import { resourceRefToUrn } from './resourceUrn';

/** The fields of a shared document a preview may be built from. */
export interface PreviewableSharedDocument {
  documentId: string;
  title: string;
  documentType: string;
  fileExtension?: string;
  editorId?: string;
  /** The index row arrived but its key did not. Unreadable, so: unavailable. */
  decryptFailed?: boolean;
}

export interface ResourcePreviewSources {
  /**
   * Every document readable by this reader right now, across the scopes this
   * window holds for the organization. `null` while the index is still loading.
   *
   * Called on every resolve rather than captured, so a document that was
   * unshared between two resolves reports `unavailable` on the second.
   */
  documents(): readonly PreviewableSharedDocument[] | null;
  /** Human label for the document's type, e.g. "Markdown". */
  describeDocumentType(document: PreviewableSharedDocument): string | undefined;
}

const UNAVAILABLE: ResourcePreviewState = { availability: 'unavailable' };
const LOADING: ResourcePreviewState = { availability: 'loading' };

export function createResourcePreviewResolver(
  sources: ResourcePreviewSources,
): ResourcePreviewResolver {
  return {
    async resolve(refs: readonly ResourceRef[]) {
      const previews: Record<string, ResourcePreviewState> = {};
      // Read once per batch, not once per ref: a batch is one moment in time,
      // and two refs in the same message disagreeing about what is shared
      // would be worse than either answer.
      const documents = sources.documents();
      for (const ref of refs) {
        previews[resourceRefToUrn(ref)] = previewFor(ref, documents, sources);
      }
      return previews;
    },
  };
}

/**
 * Kinds with no lookup yet -- session, conversation, file, commit, pullRequest,
 * feedbackRequest -- report `unavailable`. That is the honest answer for a
 * resolver that cannot see them, and it renders a stated "Unavailable" rather
 * than a spinner that never resolves.
 */
function previewFor(
  ref: ResourceRef,
  documents: readonly PreviewableSharedDocument[] | null,
  sources: ResourcePreviewSources,
): ResourcePreviewState {
  if (ref.kind !== 'document') return UNAVAILABLE;
  if (documents === null) return LOADING;

  const document = documents.find((candidate) => candidate.documentId === ref.sourceId);
  if (!document || document.decryptFailed) return UNAVAILABLE;

  const secondary = sources.describeDocumentType(document);
  const title = document.title.trim();
  return {
    availability: 'available',
    // A shared document may legitimately have no title yet. Naming that state
    // is client-side presentation, not source state the resolver learned.
    title: title === '' ? 'Untitled document' : title,
    ...(secondary ? { secondary } : {}),
  };
}
