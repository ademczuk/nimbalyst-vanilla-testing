/**
 * The desktop implementation of the canvas's `renderCard` slot.
 *
 * The runtime canvas knows a card points at `{kind:'file', path}` or
 * `{kind:'doc', uri}` and nothing else. This module is where those two become a
 * mounted editor, and it deliberately reuses the resolution the Lexical embed
 * pipeline already does rather than growing a second one:
 *
 * - `file` -> `customEditorRegistry.findRegistrationForFile` +
 *   `createEmbeddedFileHost`, over the same `readFileFromDisk` /
 *   `writeFileToDisk` / `fileChangedOnDiskAtomFamily` wiring `EmbedFrame` uses.
 *   That watcher subscription is the "alive" property: a card is the real file,
 *   so editing it in a tab updates the card and vice versa.
 * - `doc` -> `resolveCollaborativeEmbedRequest` + `CollaborativeEmbedEditor`,
 *   which acquires from the refcounted `CollaborativeEmbedProviderCache`. That
 *   refcount is what makes "lazy room connection tied to warm/hot" fall out for
 *   free: a cold card does not render this component at all, so its room is
 *   released, and a board with three visible shared cards holds three rooms
 *   rather than thirty.
 *
 * What is NOT reused is `EmbedFrame` itself. It is bound to Lexical at four
 * points -- `useLexicalComposerContext`, `useLexicalNodeSelection`, the
 * `nodeKey`-addressed resize, and the markdown-attribute geometry -- none of
 * which exist on a canvas, where geometry is the node's `x/y/width/height` and
 * activation is the surface's job. Its *machinery* is what was worth sharing,
 * and that is what the imports below are.
 *
 * Read-only tracks the detail level. Warm is read-only by definition; hot flips
 * `host.readOnly` through the existing listener rather than remounting, so
 * clicking into a card gives you the editor you were already looking at with its
 * scroll and view state intact.
 *
 * There is a third branch that is easy to miss because it looks like the second:
 * a card whose reference names a `revisionId` is **history**, and it goes to
 * `CanvasRevisionCard`, not to the live provider. Discarding the pin here and
 * opening the room anyway is not a small bug -- the runtime has already styled
 * the card as historical, locked it read-only, and labelled it "v3", so the
 * result is a card that convincingly asserts something false. `detail` alone
 * never distinguishes the two; `resolveCanvasCardRevision` does.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAtomValue } from "jotai";
import { basename } from "pathe";

import type { CanvasCardRenderProps } from "@nimbalyst/runtime/canvas";
import { resolveCanvasCardRevision } from "@nimbalyst/runtime/canvas";
import { store } from "@nimbalyst/runtime/store";

import { parseCanvasDocumentReference } from "./canvasDocumentReference";

import { customEditorRegistry } from "../CustomEditors/registry";
import { fileChangedOnDiskAtomFamily } from "../../store/atoms/fileWatch";
import { useTheme } from "../../hooks/useTheme";
import { createEmbeddedFileHost } from "./createEmbeddedFileHost";
import { CollaborativeEmbedEditor } from "./CollaborativeEmbedEditor";
import { CanvasRevisionCard } from "./CanvasRevisionCard";
import { createEmbeddedAutosaveController } from "./embeddedAutosave";
import { useCanvasRoomConnectionLease } from "./canvasRoomConnectionPolicy";
import { resolveCollaborativeEmbedRequest } from "./resolveCollaborativeEmbedRequest";
import {
  readFileFromDisk,
  workspaceAbsolutePath,
  writeFileToDisk,
} from "./embeddedFileIo";
import { getSaveFailureMessage } from "../../utils/fileSaveResult";
import {
  activeTeamOrgIdAtom,
  sharedDocumentsAtom,
} from "../../store/atoms/collabDocuments";
import { activeWorkspacePathAtom } from "../../store/atoms/openProjects";
import { collaborativeEmbedResourceKey } from "../../services/CollaborativeEmbedProviderCache";

import "./CanvasCardHost.css";

/** Matches EmbedFrame's cadence; a card is the same kind of ambient editor. */
const CANVAS_CARD_AUTOSAVE_MS = 2000;

export const CanvasCardHost: React.FC<CanvasCardRenderProps> = (props) =>
  props.reference.kind === "doc" ? (
    <CanvasDocCard {...props} />
  ) : (
    <CanvasFileCard {...props} />
  );

// ---------------------------------------------------------------------------
// `file` cards -- a real path on this machine, live via the file watcher
// ---------------------------------------------------------------------------

const CanvasFileCard: React.FC<CanvasCardRenderProps> = ({
  reference,
  label,
  detail,
}) => {
  const path = reference.kind === "file" ? reference.path : "";
  const absolutePath = useMemo(() => workspaceAbsolutePath(path), [path]);
  const registration = useMemo(
    () =>
      absolutePath
        ? customEditorRegistry.findRegistrationForFile(absolutePath)
        : undefined,
    [absolutePath]
  );

  const { theme } = useTheme();
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const themeListeners = useRef(new Set<(next: string) => void>());
  useEffect(() => {
    for (const listener of themeListeners.current) listener(theme);
  }, [theme]);

  const readOnly = detail !== "hot";
  const readOnlyRef = useRef(readOnly);
  const readOnlyListeners = useRef(new Set<(next: boolean) => void>());
  useEffect(() => {
    if (readOnlyRef.current === readOnly) return;
    readOnlyRef.current = readOnly;
    for (const listener of readOnlyListeners.current) listener(readOnly);
  }, [readOnly]);

  const dirtyRef = useRef(false);
  const saveListeners = useRef(new Set<() => void | Promise<void>>());
  const lastSavedRef = useRef<string | null>(null);
  const [saveBlockedErrorType, setSaveBlockedErrorType] = useState<
    string | null
  >(null);

  // The same controller `EmbedFrame` uses -- in-flight guard, bounded retry,
  // blocked latch. Sharing it is not tidiness: the copy that used to live here
  // was a bare `setInterval` and it was missing all three.
  const autosave = useMemo(
    () =>
      createEmbeddedAutosaveController({
        label: "[CanvasCard]",
        isDirty: () => dirtyRef.current,
        onBlockedChange: setSaveBlockedErrorType,
        save: async () => {
          for (const listener of saveListeners.current) {
            await listener();
          }
        },
      }),
    []
  );

  // Autosave only while the card is hot -- a board full of warm cards must not
  // tick once every two seconds for nothing. The cleanup is the load-bearing
  // half: it runs on hot-to-warm, and it is the last moment the read-only guard
  // and the two-second debounce can still be beaten by an edit the user made a
  // moment ago.
  useEffect(() => {
    if (readOnly) return;
    const interval = setInterval(() => {
      void autosave.tick();
    }, CANVAS_CARD_AUTOSAVE_MS);
    return () => {
      clearInterval(interval);
      void autosave.flush("cooled");
    };
  }, [readOnly, autosave]);

  // Every other way a card stops existing: it left the viewport for cold, the
  // board tab closed, the window closed. React gives all three to us as an
  // unmount, and none of them run the effect above when the card was already
  // warm -- a hot-to-warm flush that failed its one attempt would otherwise
  // never get a second.
  useEffect(
    () => () => {
      void autosave.flush("unmounted");
    },
    [autosave]
  );

  // Stable per path, so warming/heating never rebuilds it -- the extension keeps
  // its scroll, selection, and view state across the transition.
  const host = useMemo(() => {
    if (!absolutePath) return null;
    return createEmbeddedFileHost({
      embedPath: absolutePath,
      workspaceId: (window as unknown as { __workspacePath?: string })
        .__workspacePath,
      getTheme: () => themeRef.current,
      subscribeToThemeChanges(callback) {
        themeListeners.current.add(callback);
        return () => {
          themeListeners.current.delete(callback);
        };
      },
      subscribeToFileChanges(watched, callback) {
        return store.sub(fileChangedOnDiskAtomFamily(watched), () => {
          readFileFromDisk(watched)
            .then((content) => {
              // Save-echo dedup: the watcher fires on our own write, and
              // bouncing those bytes back through the extension resets its view.
              if (content === lastSavedRef.current) return;
              callback(content);
            })
            .catch((error: unknown) => {
              console.error(
                "[CanvasCard] reload after change failed for",
                watched,
                error
              );
            });
        });
      },
      readFile: readFileFromDisk,
      async saveFile(target, content) {
        const text =
          typeof content === "string"
            ? content
            : new TextDecoder().decode(content);
        lastSavedRef.current = text;
        // Throws on failure, which is what the controller's retry and blocked
        // latch key off. A card that quietly stops saving reads exactly like
        // one that is saving fine, so the blocked state gets a visible strip
        // rather than a log line nobody is looking at.
        await writeFileToDisk(target, text);
        dirtyRef.current = false;
      },
      getReadOnly: () => readOnlyRef.current,
      // The read-only guard must not eat the flush that carries the edits from
      // the hot session that just ended. See `embeddedAutosave.ts`.
      allowSaveWhileReadOnly: () => autosave.isFlushing(),
      subscribeToReadOnlyChanges(callback) {
        readOnlyListeners.current.add(callback);
        return () => {
          readOnlyListeners.current.delete(callback);
        };
      },
      onDirtyChange(next) {
        dirtyRef.current = next;
      },
      subscribeToSaveRequests(callback) {
        saveListeners.current.add(callback);
        return () => {
          saveListeners.current.delete(callback);
        };
      },
    });
  }, [absolutePath, autosave]);

  if (!absolutePath) {
    return (
      <CardNotice
        title={label || path}
        detail={path}
        note="No workspace is open."
      />
    );
  }
  if (!registration) {
    return (
      <CardNotice
        title={label || basename(absolutePath)}
        detail={path}
        note={`No installed extension renders ${basename(absolutePath)}.`}
      />
    );
  }
  if (!host) return null;

  const EditorComponent = registration.component;
  return (
    <div className="canvas-card-host">
      <EditorComponent host={host} />
      {saveBlockedErrorType !== null && (
        <div className="canvas-card-host__save-error" role="status">
          {getSaveFailureMessage(saveBlockedErrorType, "auto")}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// `doc` cards -- a shared document, resolved exactly as an embed is
// ---------------------------------------------------------------------------

const CanvasDocCard: React.FC<CanvasCardRenderProps> = ({
  reference,
  label,
  detail,
}) => {
  const uri = reference.kind === "doc" ? reference.uri : "";
  const workspacePath = useAtomValue(activeWorkspacePathAtom);
  const activeOrgId = useAtomValue(activeTeamOrgIdAtom);
  const sharedDocuments = useAtomValue(sharedDocumentsAtom);

  const parsed = useMemo(() => {
    return parseCanvasDocumentReference(uri);
  }, [uri]);

  // Same reduction to primitives EmbedFrame makes, and for the same reason:
  // `sharedDocumentsAtom` yields a new array on every TeamRoom broadcast, and
  // depending on the array would rebuild the request object -- which
  // `CollaborativeEmbedEditor` keys its provider effect on -- so the room would
  // disconnect and reconnect whenever any teammate touched any document.
  const shared = useMemo(
    () =>
      parsed
        ? sharedDocuments.find(
            (entry) => entry.documentId === parsed.documentId
          )
        : undefined,
    [parsed, sharedDocuments]
  );
  const sharedTitle = shared?.title ?? null;
  const sharedDocumentType = shared?.documentType ?? null;
  const sharedFileExtension = shared?.fileExtension ?? null;
  const sharedEditorId = shared?.editorId ?? null;

  type DocResolution =
    | { error: string; ready?: undefined }
    | {
        error?: undefined;
        ready: Extract<
          ReturnType<typeof resolveCollaborativeEmbedRequest>,
          { status: "ready" }
        >;
      };
  const resolution = useMemo<DocResolution>(() => {
    if (!parsed) return { error: "This card does not name a shared document." };
    if (!workspacePath) return { error: "No workspace is open." };
    if (activeOrgId !== null && parsed.orgId !== activeOrgId) {
      return { error: "This card belongs to a different team." };
    }
    const resolved = resolveCollaborativeEmbedRequest({
      orgId: parsed.orgId,
      documentId: parsed.documentId,
      workspacePath,
      sharedTitle,
      sharedDocumentType,
      sharedFileExtension,
      sharedEditorId,
      fallbackTitle: label,
    });
    return resolved.status === "ready"
      ? { ready: resolved }
      : { error: resolved.error };
  }, [
    parsed,
    workspacePath,
    activeOrgId,
    sharedTitle,
    sharedDocumentType,
    sharedFileExtension,
    sharedEditorId,
    label,
  ]);

  // A pinned card shows one stored revision, not the document. It holds no
  // socket -- one HTTP GET and then a detached Y.Doc -- so it takes no room
  // lease: charging it a slot would evict a live card to hold a static one.
  const pinnedRevisionId = resolveCanvasCardRevision(reference).revisionId;

  const roomLease = useCanvasRoomConnectionLease(
    resolution.ready
      ? collaborativeEmbedResourceKey(resolution.ready.request)
      : uri,
    detail,
    resolution.ready !== undefined && pinnedRevisionId === null
  );

  if (resolution.ready === undefined) {
    return (
      <CardNotice title={label || uri} detail={uri} note={resolution.error} />
    );
  }
  if (pinnedRevisionId !== null && parsed) {
    const { registration, request } = resolution.ready;
    return (
      <CanvasRevisionCard
        registration={registration}
        title={request.title}
        request={{
          workspacePath: request.workspacePath,
          uri,
          orgId: parsed.orgId,
          documentId: parsed.documentId,
          revisionId: pinnedRevisionId,
          documentType: request.documentType,
        }}
        renderNotice={(note) => (
          <CardNotice title={label || uri} detail={uri} note={note} />
        )}
      />
    );
  }
  if (!roomLease.granted) {
    return (
      <div className="canvas-card-host" data-canvas-room-connection="queued">
        <CardNotice
          title={label || uri}
          detail={uri}
          note="Waiting for an available shared-card connection."
        />
      </div>
    );
  }
  const { registration, request } = resolution.ready;

  return (
    <div className="canvas-card-host" data-canvas-room-connection="active">
      <CollaborativeEmbedEditor
        registration={registration}
        request={request}
        readOnly={detail !== "hot"}
        onConnectionReleased={roomLease.acknowledgeConnectionReleased}
      />
    </div>
  );
};

const CardNotice: React.FC<{ title: string; detail: string; note: string }> = ({
  title,
  detail,
  note,
}) => (
  <div className="canvas-card-host__notice select-text">
    <div className="canvas-card-host__notice-title">{title}</div>
    <div className="canvas-card-host__notice-detail">{detail}</div>
    <div className="canvas-card-host__notice-note">{note}</div>
  </div>
);
