/**
 * An artifact that is still a file on this machine, painted with its real
 * editor.
 *
 * Every other preview path in this feature resolves a *published* document
 * through a collab room, and declines anything else. That was right for the
 * recipient -- publishing rewrites a `file` ref to a `document`, so a `file`
 * ref never reaches one -- and it quietly made two common cases render a grey
 * box with a letter in it:
 *
 * - **Compose.** The author reviewing their own draft is looking at artifacts
 *   that have not been published yet, by design: nothing leaves the machine
 *   until they approve it. Every artifact in a draft is a `file` ref, so the
 *   surface where you decide what to send was the one surface that could not
 *   show you what you were sending.
 * - **Asking yourself.** When the recipient can already see the resource,
 *   nothing is published, so the refs stay `file` on the delivered request too.
 *
 * Both are answered here, and neither needs collaboration: the file is on disk,
 * the extension that paints it is registered in this build, and the SDK already
 * ships a host for exactly this shape -- `createReadOnlyHost`, which serves
 * pre-loaded content with no IPC and no document id.
 *
 * Renderer-only. The no-dynamic-import rule covers the Electron main process.
 */

import React from 'react';
import { createReadOnlyHost } from '@nimbalyst/extension-sdk';
import type { EditorViewport } from '@nimbalyst/runtime';
import { FeedbackOptionPlaceholderPreview } from '@nimbalyst/collab-client/feedback-ui';

import { customEditorRegistry } from '../CustomEditors/registry';
import { useTheme } from '../../hooks/useTheme';

/** Absolute, or workspace-relative in which case the workspace root is joined on. */
function resolveAbsolutePath(sourceId: string, workspacePath: string | null): string | null {
  if (sourceId.startsWith('/')) return sourceId;
  if (!workspacePath) return null;
  return `${workspacePath.replace(/\/$/, '')}/${sourceId}`;
}

type Content =
  | { status: 'loading' }
  | { status: 'ready'; text: string }
  /** The file moved, or was never there. A titled card, not an empty frame. */
  | { status: 'failed' };

export const FeedbackLocalArtifactPreview: React.FC<{
  /** Workspace-relative or absolute path to the artifact on this machine. */
  sourceId: string;
  workspacePath: string | null;
  label: string;
  /** Captions the fallback when there is nothing to paint. */
  optionLabel: string;
  onViewportRegistered?: (viewport: EditorViewport | null) => void;
}> = ({ sourceId, workspacePath, label, optionLabel, onViewportRegistered }) => {
  const { theme } = useTheme();
  const filePath = React.useMemo(
    () => resolveAbsolutePath(sourceId, workspacePath),
    [sourceId, workspacePath],
  );
  const registration = React.useMemo(
    () => (filePath ? customEditorRegistry.findRegistrationForFile(filePath) : undefined),
    [filePath],
  );
  const [content, setContent] = React.useState<Content>({ status: 'loading' });

  React.useEffect(() => {
    // No registered editor means nothing to paint, so the read is skipped
    // rather than performed and thrown away.
    if (!filePath || !registration) return;
    let active = true;
    setContent({ status: 'loading' });
    void window.electronAPI.readFileContent(filePath)
      .then((result) => {
        if (!active) return;
        setContent(result?.success && typeof result.content === 'string'
          ? { status: 'ready', text: result.content }
          : { status: 'failed' });
      })
      .catch(() => {
        if (active) setContent({ status: 'failed' });
      });
    return () => {
      active = false;
    };
  }, [filePath, registration]);

  /*
   * Rebuilt only when the content or the file changes. The host is a mount
   * dependency for the extension component, so an identity that churned on
   * every theme tick would remount the editor mid-render; the theme reaches a
   * live editor through `setTheme` below instead.
   */
  const host = React.useMemo(() => {
    if (content.status !== 'ready' || !filePath) return null;
    return createReadOnlyHost(content.text, {
      theme,
      fileName: filePath.split('/').pop() ?? label,
      filePath,
      // Both true, and both load-bearing: `embedded` is what makes MockupEditor
      // drop its toolbar and make in-mockup links inert, and `readOnly` is what
      // keeps a viewer's clicks from reaching an editing path.
      embedded: true,
      onViewportRegistered,
    });
    // `theme` is deliberately not a dependency; see the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, filePath, label, onViewportRegistered]);

  React.useEffect(() => {
    host?.setTheme(theme);
  }, [host, theme]);

  if (!registration || content.status === 'failed') {
    return (
      <FeedbackOptionPlaceholderPreview label={optionLabel} artifactLabel={label} />
    );
  }
  if (!host) {
    // Same card while the file loads as when there is nothing to load, so the
    // panel does not flash a second empty state on the way in.
    return (
      <FeedbackOptionPlaceholderPreview label={optionLabel} artifactLabel={label} />
    );
  }

  const EditorComponent = registration.component;
  return <EditorComponent host={host} />;
};
