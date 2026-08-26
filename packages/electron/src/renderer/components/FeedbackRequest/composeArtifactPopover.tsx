/**
 * The compose surface's way to actually look at an artifact.
 *
 * A 128px card scaled down from a 1000px design is a recognition aid, and for
 * a dark mockup it is barely even that -- measured on the real thing, a badge
 * row lands 10px tall with 3.6px type on a near-black background. The preview
 * is rendering correctly and still reads as a grey box, which is exactly the
 * complaint the previews were meant to answer.
 *
 * So compose gets the same detail popover the recipient has. It lives in
 * `collab-client`, which depends on the runtime package the compose widget
 * lives in, so the widget cannot import it -- this module is the Electron side
 * of that seam.
 *
 * No vote in the footer: the author is reviewing what they are about to send,
 * not answering it. Stepping, scrolling and opening in a tab are the whole job.
 */

import React from 'react';
import type { FeedbackAskArtifact } from '@nimbalyst/collab-protocol';
import type {
  FeedbackComposeArtifactPopoverProps,
} from '@nimbalyst/runtime/ui/AgentTranscript/components/CustomToolWidgets/InteractiveWidgetHost';

import { renderFeedbackArtifactDetail } from './FeedbackArtifactDetail';

/*
 * Deep path and lazy, both deliberate. The package barrel exports this
 * component's *types only* -- a value export there puts `@floating-ui/react`
 * in the browser bundle's eager graph, which is measured and which it blew by
 * two thirds. Loading it on the click that opens it keeps the transcript's
 * module graph clear of it too.
 */
const FeedbackArtifactDetailPopover = React.lazy(async () => ({
  default: (await import('@nimbalyst/collab-client/feedback-ui/FeedbackArtifactDetailPopover'))
    .FeedbackArtifactDetailPopover,
}));

export function renderComposeArtifactPopover(
  props: FeedbackComposeArtifactPopoverProps,
  workspacePath: string | null,
): React.ReactNode {
  return (
    <React.Suspense fallback={null}>
    <FeedbackArtifactDetailPopover
      entries={props.entries}
      activeEntryId={props.activeEntryId}
      onActiveEntryChange={props.onActiveEntryChange}
      onDismiss={props.onDismiss}
      anchor={props.anchor}
      renderArtifact={(entry, api) =>
        renderFeedbackArtifactDetail(entry, api, workspacePath)}
      onOpenInTab={(artifact: FeedbackAskArtifact) => {
        // A draft's artifacts are files in this workspace, so "open" is the
        // ordinary file-open path rather than a shared-document route.
        if (!workspacePath || artifact.ref.kind !== 'file') return;
        void window.electronAPI.invoke('workspace:open-file', {
          workspacePath,
          filePath: artifact.ref.sourceId.startsWith('/')
            ? artifact.ref.sourceId
            : `${workspacePath.replace(/\/$/, '')}/${artifact.ref.sourceId}`,
        });
      }}
    />
    </React.Suspense>
  );
}
