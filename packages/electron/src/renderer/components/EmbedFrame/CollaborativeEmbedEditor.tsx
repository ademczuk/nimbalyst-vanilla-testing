import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { EditorHost, EditorViewport } from '@nimbalyst/runtime';

import type { CustomEditorRegistration } from '../CustomEditors/types';
import { useTheme } from '../../hooks/useTheme';
import {
  collaborativeEmbedProviderCache,
  collaborativeEmbedResourceKey,
  type CollaborativeEmbedProviderAcquisition,
  type CollaborativeEmbedProviderRequest,
} from '../../services/CollaborativeEmbedProviderCache';
import { buildCollabUri } from '@nimbalyst/collab-protocol';
import { createCollabExtensionHost } from '../TabEditor/collabExtensionHost';

interface CollaborativeEmbedEditorProps {
  registration: CustomEditorRegistration;
  request: CollaborativeEmbedProviderRequest;
  /**
   * Receives the editor's scroll viewport, when it publishes one.
   *
   * Only the feedback detail popover passes this, so it can carry the reader's
   * place from one design alternative to the next. An embed with no listener,
   * or an editor that never registers, simply has no viewport.
   */
  onViewportRegistered?: (viewport: EditorViewport | null) => void;
}

export const CollaborativeEmbedEditor: React.FC<
  CollaborativeEmbedEditorProps
> = ({ registration, request, onViewportRegistered }) => {
  const { theme } = useTheme();
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const themeListeners = useRef(new Set<(nextTheme: string) => void>());
  const [acquisition, setAcquisition] =
    useState<CollaborativeEmbedProviderAcquisition | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    for (const listener of themeListeners.current) listener(theme);
  }, [theme]);

  // Acquire on the request's VALUE, not its identity. An equal-but-new request
  // object (a parent re-render) must not disconnect and rebuild a live child
  // room; only a genuinely different room or editor configuration should.
  const resourceKey = collaborativeEmbedResourceKey(request);
  const requestRef = useRef(request);
  requestRef.current = request;

  useEffect(() => {
    let cancelled = false;
    let acquired: CollaborativeEmbedProviderAcquisition | null = null;
    setAcquisition(null);
    setError(null);
    void collaborativeEmbedProviderCache.acquire(requestRef.current)
      .then(next => {
        if (cancelled) {
          next.release();
          return;
        }
        acquired = next;
        setAcquisition(next);
      })
      .catch(reason => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason : new Error(String(reason)));
        }
      });
    return () => {
      cancelled = true;
      acquired?.release();
    };
  }, [resourceKey]);

  /*
   * Held off the host's dependencies. The host object is a mount dependency for
   * the extension component, and a caller passing a fresh arrow function each
   * render would rebuild it -- tearing down a live collaborative editor and its
   * Y.Doc on every parent re-render.
   */
  const viewportRef = useRef(onViewportRegistered);
  viewportRef.current = onViewportRegistered;

  const { orgId, documentId, title, workspacePath } = request;
  const host = useMemo<EditorHost | null>(() => {
    if (!acquisition) return null;
    const filePath = buildCollabUri(orgId, documentId);
    return createCollabExtensionHost({
      filePath,
      fileName: title,
      isActive: true,
      workspaceId: workspacePath,
      activeConfig: acquisition.resource.config,
      collaboration: acquisition.resource.collaboration,
      getTheme: () => themeRef.current,
      subscribeToThemeChanges: callback => {
        themeListeners.current.add(callback);
        return () => {
          themeListeners.current.delete(callback);
        };
      },
      embedded: true,
      readOnly: true,
      // Reads the ref at call time rather than capturing it, so a caller that
      // swaps its handler still gets the next registration.
      onViewportRegistered: viewport => viewportRef.current?.(viewport),
    });
  }, [acquisition, documentId, orgId, title, workspacePath]);

  if (error) {
    return (
      <div
        className="embed-frame__body--placeholder"
        data-testid="collaborative-embed-error"
      >
        <p>Could not load shared embed</p>
        <code>{error.message}</code>
      </div>
    );
  }

  if (!host) {
    return (
      <div
        className="embed-frame__loading"
        data-testid="collaborative-embed-loading"
      >
        Loading shared embed...
      </div>
    );
  }

  const ExtensionComponent = registration.component;
  return <ExtensionComponent host={host} />;
};
