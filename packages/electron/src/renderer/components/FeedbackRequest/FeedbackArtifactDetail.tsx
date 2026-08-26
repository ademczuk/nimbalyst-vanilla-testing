/**
 * The desktop app's full-size artifact, for the detail popover.
 *
 * The sibling of `FeedbackOptionArtifactPreview`, and it declines in exactly
 * the same places for exactly the same reasons -- a non-`document` ref, an
 * unknown document id, a type with no registered editor. What differs is what
 * happens after it succeeds:
 *
 * - **No `ScaledPreviewFrame`.** The card scales a document down to be
 *   recognised; this one hands the editor the popover's whole box so it is
 *   read at something close to the size it was drawn at.
 * - **A priority slot.** The card's slot yields to nothing, because a preview
 *   scrolled past is not worth mounting. This is the artifact the user is
 *   looking at, so it takes a slot ahead of any card behind it -- see
 *   `useLivePreviewSlot`.
 * - **It forwards a viewport.** The scroll position lives inside the
 *   extension's iframe. The editor publishes one through
 *   `EditorHost.registerViewport` and this passes it up, which is the whole
 *   mechanism behind stepping between options without losing your place.
 */

import React from 'react';
import { useAtomValue } from 'jotai';
import type {
  FeedbackArtifactDetailEntry,
  FeedbackArtifactDetailMountApi,
} from '@nimbalyst/collab-client/feedback-ui';
import { useLivePreviewSlot } from '@nimbalyst/collab-client/feedback-ui';

import { sharedDocumentsAtom } from '../../store/atoms/collabDocuments';
import { activeWorkspacePathAtom } from '../../store/atoms/openProjects';
import { resolveCollaborativeEmbedRequest } from '../EmbedFrame/resolveCollaborativeEmbedRequest';

/** Lazy for the reason `FeedbackOptionArtifactPreview` documents. */
const CollaborativeEmbedEditor = React.lazy(async () => ({
  default: (await import('../EmbedFrame/CollaborativeEmbedEditor')).CollaborativeEmbedEditor,
}));

const FeedbackLocalArtifactPreview = React.lazy(async () => ({
  default: (await import('./FeedbackLocalArtifactPreview')).FeedbackLocalArtifactPreview,
}));

/**
 * A local artifact at full size, for the popover.
 *
 * Takes a priority slot exactly as the collaborative one does -- the reason is
 * the surface, not the transport: this is the artifact the user is looking at,
 * so it outranks any card behind it.
 */
const FeedbackLocalArtifactDetail: React.FC<{
  entry: FeedbackArtifactDetailEntry;
  api: FeedbackArtifactDetailMountApi;
  /**
   * Supplied by compose, which knows its own session's workspace and must not
   * read the active one: a transcript can be open against a project that is
   * not the foreground window's, and resolving a draft's files against the
   * wrong root silently paints nothing.
   */
  workspacePathOverride?: string | null;
}> = ({ entry, api, workspacePathOverride }) => {
  const activeWorkspacePath = useAtomValue(activeWorkspacePathAtom);
  const workspacePath = workspacePathOverride ?? activeWorkspacePath;
  const { ref, mounted } = useLivePreviewSlot<HTMLDivElement>(
    Boolean(workspacePath),
    { priority: true },
  );

  /*
   * Keyed on the entry alone. `api` is stable now, but depending on it here is
   * what made this cleanup fire on every render and wipe the registration the
   * editor had just made.
   */
  const apiRef = React.useRef(api);
  apiRef.current = api;
  React.useEffect(() => () => apiRef.current.onViewportReady(null), [entry.entryId]);

  return (
    <div ref={ref} className="feedback-artifact-detail h-full w-full">
      {mounted && (
        <React.Suspense fallback={null}>
          <FeedbackLocalArtifactPreview
            sourceId={entry.artifact.ref.sourceId}
            workspacePath={workspacePath}
            label={entry.artifact.label}
            optionLabel={entry.label}
            onViewportRegistered={api.onViewportReady}
          />
        </React.Suspense>
      )}
    </div>
  );
};

export const FeedbackArtifactDetail: React.FC<{
  entry: FeedbackArtifactDetailEntry;
  api: FeedbackArtifactDetailMountApi;
}> = ({ entry, api }) => {
  const sharedDocuments = useAtomValue(sharedDocumentsAtom);
  const workspacePath = useAtomValue(activeWorkspacePathAtom);
  const { artifact } = entry;

  const resolution = React.useMemo(() => {
    if (artifact.ref.kind !== 'document' || !workspacePath) return null;
    const document = sharedDocuments.find(
      (candidate) => candidate.documentId === artifact.ref.sourceId,
    );
    if (!document) return null;
    const resolved = resolveCollaborativeEmbedRequest({
      orgId: artifact.ref.orgId,
      documentId: artifact.ref.sourceId,
      workspacePath,
      sharedTitle: document.title,
      sharedDocumentType: document.documentType,
      sharedFileExtension: document.fileExtension,
      sharedEditorId: document.editorId,
      fallbackTitle: artifact.label,
    });
    return resolved.status === 'ready' ? resolved : null;
  }, [artifact, sharedDocuments, workspacePath]);

  const { ref, mounted } = useLivePreviewSlot<HTMLDivElement>(
    resolution !== null,
    { priority: true },
  );

  /*
   * Unregister on the way out, and on the way in if the entry changed. Keyed on
   * the entry alone: depending on `api` re-ran this every render and nulled the
   * viewport the editor had just published.
   */
  const apiRef = React.useRef(api);
  apiRef.current = api;
  React.useEffect(() => () => apiRef.current.onViewportReady(null), [entry.entryId]);

  return (
    <div ref={ref} className="feedback-artifact-detail h-full w-full">
      {mounted && resolution && (
        <React.Suspense fallback={null}>
          <CollaborativeEmbedEditor
            registration={resolution.registration}
            request={resolution.request}
            onViewportRegistered={api.onViewportReady}
          />
        </React.Suspense>
      )}
    </div>
  );
};

/**
 * Returning nullish is what tells the popover to show its own "cannot be shown
 * here" chrome, so the decline has to happen *before* the component mounts --
 * a component that renders nothing is an empty frame, which reads as a preview
 * that broke rather than one that was never promised.
 */
export function renderFeedbackArtifactDetail(
  entry: FeedbackArtifactDetailEntry,
  api: FeedbackArtifactDetailMountApi,
  workspacePathOverride?: string | null,
): React.ReactNode {
  // An unpublished artifact is still on disk, and the popover is exactly where
  // an author wants to look at one properly before sending it.
  if (entry.artifact.ref.kind === 'file') {
    return (
      <FeedbackLocalArtifactDetail
        key={entry.entryId}
        entry={entry}
        api={api}
        workspacePathOverride={workspacePathOverride}
      />
    );
  }
  if (entry.artifact.ref.kind !== 'document') return undefined;
  return <FeedbackArtifactDetail key={entry.entryId} entry={entry} api={api} />;
}
