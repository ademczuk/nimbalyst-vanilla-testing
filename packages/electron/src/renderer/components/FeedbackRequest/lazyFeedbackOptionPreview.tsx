/**
 * The option-card preview renderer, one module boundary further out.
 *
 * `FeedbackOptionArtifactPreview` already loads the collaborative *editor*
 * lazily, but resolving which editor to mount is synchronous and reaches the
 * custom-editor registry, which reaches the renderer logger, which reaches
 * `electron-log/renderer`. That chain lands in the module graph of every
 * surface that can show a request — the Inbox, the shared area's feedback list —
 * whether or not any option has an artifact bound to it, and most requests bind
 * none.
 *
 * So the preview module itself is behind a lazy boundary here, and the
 * "no artifact means no preview" contract is preserved above it: an unbound
 * option still returns `undefined` synchronously and keeps the card's own
 * placeholder path, and a bound one shows the same placeholder as the Suspense
 * fallback while the chunk loads.
 *
 * Renderer-only. The no-dynamic-import rule covers the Electron main process.
 */

import React from 'react';
import type {
  FeedbackAskArtifact,
  StructuredInputSingleSelectOption,
} from '@nimbalyst/collab-protocol';
import { useAtomValue } from 'jotai';
import {
  FeedbackOptionPlaceholderPreview,
  ScaledPreviewFrame,
  useLivePreviewSlot,
} from '@nimbalyst/collab-client/feedback-ui';

import { activeWorkspacePathAtom } from '../../store/atoms/openProjects';

const LazyFeedbackOptionArtifactPreview = React.lazy(async () => ({
  default: (await import('./FeedbackOptionArtifactPreview'))
    .FeedbackOptionArtifactPreview,
}));

/**
 * The local-file path, behind the same boundary and for the same reason: it
 * reaches the custom-editor registry, which most requests never need.
 */
const LazyFeedbackLocalArtifactPreview = React.lazy(async () => ({
  default: (await import('./FeedbackLocalArtifactPreview'))
    .FeedbackLocalArtifactPreview,
}));

export function renderLazyFeedbackOptionPreview(
  option: StructuredInputSingleSelectOption,
  _index: number,
  artifact?: FeedbackAskArtifact,
): React.ReactNode {
  if (!artifact) return undefined;
  /*
   * A `file` ref is a real artifact on this machine, not a degraded document
   * one. It reaches a recipient only when nothing was published -- most often
   * because the recipient could already see it -- and declining it was why
   * asking yourself for feedback showed grey boxes.
   */
  if (artifact.ref.kind === 'file') {
    return (
      <React.Suspense
        key={artifact.ref.sourceId}
        fallback={(
          <FeedbackOptionPlaceholderPreview
            label={option.label}
            artifactLabel={artifact.label}
          />
        )}
      >
        <LocalArtifactPreviewSlot option={option} artifact={artifact} />
      </React.Suspense>
    );
  }
  return (
    <React.Suspense
      key={artifact.ref.sourceId}
      fallback={(
        <FeedbackOptionPlaceholderPreview
          label={option.label}
          artifactLabel={artifact.label}
        />
      )}
    >
      <LazyFeedbackOptionArtifactPreview
        artifact={artifact}
        optionLabel={option.label}
      />
    </React.Suspense>
  );
}

/**
 * The workspace lookup and the mount gate for a local artifact.
 *
 * Separate from `FeedbackLocalArtifactPreview` so that component stays a pure
 * "paint this path" and can be reused by the compose surface, which has its own
 * workspace path and no slot budget to share.
 *
 * The cap applies here even though nothing opens a socket: a local mockup still
 * mounts an extension editor with an iframe in it, and a request scrolled past
 * should not pay for three of them.
 */
const LocalArtifactPreviewSlot: React.FC<{
  option: StructuredInputSingleSelectOption;
  artifact: FeedbackAskArtifact;
}> = ({ option, artifact }) => {
  const workspacePath = useAtomValue(activeWorkspacePathAtom);
  const { ref, mounted } = useLivePreviewSlot<HTMLDivElement>(Boolean(workspacePath));

  return (
    <div ref={ref} className="feedback-local-artifact-preview h-full w-full">
      {mounted ? (
        <ScaledPreviewFrame>
          <LazyFeedbackLocalArtifactPreview
            sourceId={artifact.ref.sourceId}
            workspacePath={workspacePath}
            label={artifact.label}
            optionLabel={option.label}
          />
        </ScaledPreviewFrame>
      ) : (
        <FeedbackOptionPlaceholderPreview
          label={option.label}
          artifactLabel={artifact.label}
        />
      )}
    </div>
  );
};

/**
 * The compose surface's artifact painter.
 *
 * Compose is always looking at unpublished `file` refs -- nothing leaves the
 * machine before the author approves -- so this goes straight to the local
 * path rather than checking the ref kind first. It still declines anything
 * else, because a draft can name a tracker or a session too, and neither has a
 * picture.
 *
 * The workspace path is passed in rather than read from an atom: compose runs
 * inside the transcript, whose session already knows its own workspace, and a
 * second source of that truth is how a preview ends up resolving against the
 * wrong project.
 */
export function renderComposeArtifactPreview(
  entry: { id: string; label: string },
  artifact: FeedbackAskArtifact,
  workspacePath: string | null,
): React.ReactNode {
  if (artifact.ref.kind !== 'file') return undefined;
  return (
    <React.Suspense
      key={artifact.ref.sourceId}
      fallback={(
        <FeedbackOptionPlaceholderPreview
          label={entry.label}
          artifactLabel={artifact.label}
        />
      )}
    >
      <ScaledPreviewFrame>
        <LazyFeedbackLocalArtifactPreview
          sourceId={artifact.ref.sourceId}
          workspacePath={workspacePath}
          label={artifact.label}
          optionLabel={entry.label}
        />
      </ScaledPreviewFrame>
    </React.Suspense>
  );
}
