/**
 * A canvas card pinned to a past revision.
 *
 * The live sibling is `CollaborativeEmbedEditor`, and the difference between
 * them is the only difference that matters for this card: that one acquires a
 * room from the refcounted provider cache and follows head, this one loads one
 * stored revision into a detached Y.Doc and follows nothing. A pinned card that
 * went through the live path would render head under a "v3" label -- styled as
 * history, locked read-only, and wrong.
 *
 * Three consequences of "detached" that are worth stating, because each one is
 * a property the reader is relying on:
 *
 * - **No socket.** A pinned card does not take a room lease. The shared-room
 *   ceiling counts live connections, and a revision snapshot is one HTTP GET
 *   and then nothing; charging it a slot would evict a live card to hold a
 *   static one.
 * - **No write path.** The host is built with `readOnly: true` and its
 *   `saveContent` is already a no-op for collaborative documents, so there is
 *   no route from this mount back to the room. See the header of
 *   `canvasRevisionSnapshot.ts` for why that is load-bearing rather than
 *   incidental.
 * - **No peers.** Awareness is a local instance with no transport, so the
 *   editor's presence machinery works and simply sees an empty room. An
 *   extension that assumed at least one remote state would be broken by an
 *   ordinary solo document too.
 *
 * A failure renders its reason. An empty editor and "this revision could not be
 * loaded" look identical on a board, and only one of them is true.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Awareness } from 'y-protocols/awareness';
import type { Doc } from 'yjs';

import type {
  CollaborationContext,
  CollaborationStatus,
  EditorHost,
} from '@nimbalyst/runtime';
import { buildCollabUri } from '@nimbalyst/collab-protocol';

import type { CustomEditorRegistration } from '../CustomEditors/types';
import { useTheme } from '../../hooks/useTheme';
import { createCollabExtensionHost } from '../TabEditor/collabExtensionHost';
import {
  loadCanvasRevisionSnapshot,
  type CanvasRevisionSnapshot,
  type CanvasRevisionSnapshotRequest,
} from './canvasRevisionSnapshot';

interface CanvasRevisionCardProps {
  registration: CustomEditorRegistration;
  request: CanvasRevisionSnapshotRequest;
  title: string;
  /** Rendered when the snapshot cannot be loaded. */
  renderNotice(note: string): React.ReactElement;
}

export const CanvasRevisionCard: React.FC<CanvasRevisionCardProps> = ({
  registration,
  request,
  title,
  renderNotice,
}) => {
  const { theme } = useTheme();
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const themeListeners = useRef(new Set<(next: string) => void>());
  useEffect(() => {
    for (const listener of themeListeners.current) listener(theme);
  }, [theme]);

  const [snapshot, setSnapshot] = useState<CanvasRevisionSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Keyed on the primitives rather than the request object: a parent re-render
  // that rebuilds an equal request must not refetch the revision.
  const { workspacePath, uri, orgId, documentId, revisionId, documentType } =
    request;
  useEffect(() => {
    let cancelled = false;
    let loaded: Doc | null = null;
    setSnapshot(null);
    setError(null);
    void loadCanvasRevisionSnapshot({
      workspacePath,
      uri,
      orgId,
      documentId,
      revisionId,
      documentType,
    })
      .then((next) => {
        loaded = next.doc;
        if (cancelled) {
          next.doc.destroy();
          return;
        }
        setSnapshot(next);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(
          reason instanceof Error ? reason.message : String(reason)
        );
      });
    return () => {
      cancelled = true;
      loaded?.destroy();
    };
  }, [workspacePath, uri, orgId, documentId, revisionId, documentType]);

  const host = useMemo<EditorHost | null>(() => {
    if (!snapshot) return null;
    return createCollabExtensionHost({
      filePath: buildCollabUri(orgId, documentId),
      fileName: title,
      isActive: true,
      workspaceId: workspacePath,
      activeConfig: snapshot.config,
      collaboration: createDetachedCollaborationContext(
        snapshot.doc,
        snapshot.config.teamMemberId,
        snapshot.config.userName ?? snapshot.config.teamMemberId
      ),
      getTheme: () => themeRef.current,
      subscribeToThemeChanges: (callback) => {
        themeListeners.current.add(callback);
        return () => {
          themeListeners.current.delete(callback);
        };
      },
      embedded: true,
      readOnly: true,
    });
  }, [snapshot, orgId, documentId, title, workspacePath]);

  if (error !== null) return renderNotice(error);
  if (!host) {
    return (
      <div
        className="canvas-card-host__notice select-text"
        data-canvas-card-state="revision-loading"
      >
        <div className="canvas-card-host__notice-note">Loading revision...</div>
      </div>
    );
  }

  const EditorComponent = registration.component;
  return (
    <div className="canvas-card-host" data-canvas-card-state="revision">
      <EditorComponent host={host} />
    </div>
  );
};

/**
 * A `CollaborationContext` over a document that is not collaborating.
 *
 * Every member is answered truthfully rather than optimistically. `getStatus`
 * reports `offline-unsynced`, not `connected`: an editor that renders a
 * connection pip must not claim this static snapshot is live. `flushWithAck`
 * resolves `false` for the same reason -- nothing here can be acked, and a
 * `true` would tell the SDK's first-open seed path that content it wrote had
 * reached a server. `loadInitialContent` returns the empty string so the seed
 * path, if an extension runs it, writes nothing into the scratch doc.
 */
function createDetachedCollaborationContext(
  yDoc: Doc,
  userId: string,
  userName: string
): CollaborationContext {
  const awareness = new Awareness(yDoc);
  return {
    yDoc,
    awareness,
    user: { id: userId, name: userName, color: '#6b7280' },
    getStatus: (): CollaborationStatus => 'offline-unsynced',
    onStatusChange: () => () => {},
    loadInitialContent: async () => '',
    flushWithAck: async () => false,
    // Read as the SDK reads it: "an empty doc here does not license a
    // first-open seed". A revision that was genuinely empty must render empty,
    // not as whatever default document the extension would have written -- the
    // reader is looking at this card to find out what v3 contained.
    hasUndecodedContent: () => true,
    reportSeedOutcome: () => {},
    flushLocalState: async () => {},
    registerRevisionAdapter: () => () => {},
    registerContentFlush: () => () => {},
  };
}
