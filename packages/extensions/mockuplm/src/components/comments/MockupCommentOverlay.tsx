/**
 * Comment pins drawn above the mockup frame.
 *
 * The overlay is a sibling of the iframe, never inside it: author HTML can
 * neither restyle a pin nor swallow a click on one. It takes an iframe ref, a
 * pin store, and a thread source -- no host APIs, no Electron -- so the web
 * console can mount it against the same three inputs.
 *
 * `source` is null when the host offers no comments service. Pins already in
 * the shared doc still render (a peer on a newer host may have placed them),
 * but there is no author, no composer, and no placement.
 *
 * Pointer events are off for the overlay itself so the mockup stays usable
 * underneath; only the pins themselves opt back in.
 */

import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";
import { numberUnresolvedPins } from "../../comments/mockupPinRepository";
import type {
  MockupCommentSource,
  MockupCommentThread,
} from "../../comments/mockupCommentSource";
import type { MockupPinStore } from "../../comments/mockupPinStore";
import { MockupCommentComposer } from "./MockupCommentComposer";
import { MockupCommentPin, PIN_DIAMETER } from "./MockupCommentPin";
import {
  useMockupCommentMode,
  type MockupPinDraftPlacement,
} from "./useMockupCommentMode";
import { useMockupPinLayout } from "./useMockupPinLayout";

const NO_THREADS: readonly MockupCommentThread[] = Object.freeze([]);
const NO_SUBSCRIPTION = () => () => {};
const NO_SNAPSHOT = () => NO_THREADS;

export interface MockupCommentOverlayProps {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  store: MockupPinStore;
  /** Null when the host offers no comments service. */
  source: MockupCommentSource | null;
  /** Bumped after the mockup HTML has been rendered into the frame. */
  contentVersion: number;
  /** Active viewport preset width; null = full width. */
  viewportWidth: number | null;
  isCommentMode: boolean;
  /** The thread selected in the pane; its pin renders highlighted. */
  activeThreadId?: string | null;
  /** Raised when a pin is clicked, with the thread it stands for. */
  onSelectThread?: (threadId: string | null) => void;
}

export function MockupCommentOverlay({
  iframeRef,
  store,
  source,
  contentVersion,
  viewportWidth,
  isCommentMode,
  activeThreadId = null,
  onSelectThread,
}: MockupCommentOverlayProps) {
  const pins = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  const threads = useSyncExternalStore(
    source?.subscribe ?? NO_SUBSCRIPTION,
    source?.getThreads ?? NO_SNAPSHOT,
    source?.getThreads ?? NO_SNAPSHOT
  );
  const layout = useMockupPinLayout({
    iframeRef,
    store,
    contentVersion,
    viewportWidth,
  });
  const [draft, setDraft] = useState<MockupPinDraftPlacement | null>(null);

  // Never cached: the host refreshes capabilities from the document access
  // source, so a mid-session downgrade has to land on the next render.
  const canComment = source?.canComment() ?? false;
  useMockupCommentMode({
    iframeRef,
    active: isCommentMode && canComment,
    contentVersion,
    onPlace: setDraft,
  });

  // Leaving comment mode abandons an open composer, and abandoning never writes.
  useEffect(() => {
    if (!isCommentMode || !canComment) setDraft(null);
  }, [isCommentMode, canComment]);

  const threadByPin = new Map(threads.map((thread) => [thread.pinId, thread]));
  const resolvedPinIds = new Set(
    threads.filter((thread) => thread.resolved).map((thread) => thread.pinId)
  );
  const numbers = numberUnresolvedPins(pins, resolvedPinIds);
  const activePinId =
    threads.find((thread) => thread.threadId === activeThreadId)?.pinId ?? null;

  const frameRect = draft ? iframeRef.current?.getBoundingClientRect() : undefined;

  return (
    <div
      className="mockup-comment-overlay absolute inset-0 overflow-hidden"
      style={{ pointerEvents: "none", zIndex: 500 }}
    >
      {layout.placements.map((placement) => (
        <MockupCommentPin
          key={placement.pin.id}
          placement={placement}
          number={numbers.get(placement.pin.id) ?? 0}
          thread={threadByPin.get(placement.pin.id)}
          isActive={placement.pin.id === activePinId}
          onSelect={
            source
              ? (pinId) => onSelectThread?.(source.openThread(pinId))
              : undefined
          }
        />
      ))}

      {draft && (
        <span
          className="mockup-comment-draft-pin absolute rounded-full border border-dashed"
          style={{
            left: draft.left - PIN_DIAMETER / 2,
            top: draft.top - PIN_DIAMETER,
            width: PIN_DIAMETER,
            height: PIN_DIAMETER,
            borderColor: "#f5a623",
            background: "rgba(245, 166, 35, 0.25)",
          }}
        />
      )}

      {draft && frameRect && source && (
        <MockupCommentComposer
          anchor={{
            x: frameRect.left + draft.left,
            y: frameRect.top + draft.top,
          }}
          authorName={source.viewer.name}
          onSubmit={(bodyText) => {
            // The pin is rolled back inside the source when the platform
            // refuses the thread, so there is nothing to undo here -- but the
            // failure must not be swallowed into a silent no-op.
            void source.createThread(draft.draft, bodyText).catch((error) => {
              console.error("[MockupLM] comment thread was refused", error);
            });
            setDraft(null);
          }}
          onDiscard={() => setDraft(null)}
        />
      )}

      <MockupCommentTray
        hiddenCount={layout.hidden.length}
        detachedCount={layout.detached.length}
      />
    </div>
  );
}

/**
 * Counts for pins that must not be drawn on the canvas: hidden ones (the
 * target exists but is not rendered right now) and detached ones (the anchor
 * could not be re-found). Drawing either at a stale coordinate would be worse
 * than listing it.
 */
function MockupCommentTray({
  hiddenCount,
  detachedCount,
}: {
  hiddenCount: number;
  detachedCount: number;
}) {
  if (hiddenCount === 0 && detachedCount === 0) return null;
  return (
    <div
      className="mockup-comment-tray absolute bottom-4 left-4 flex gap-2 rounded-md border border-nim bg-nim-secondary px-2 py-1 text-[11px] text-nim-muted shadow-lg"
      style={{ pointerEvents: "auto" }}
    >
      {hiddenCount > 0 && (
        <span
          className="mockup-comment-hidden-count"
          title="Comments on elements that are not currently shown"
        >
          {hiddenCount} hidden
        </span>
      )}
      {detachedCount > 0 && (
        <span
          className="mockup-comment-detached-count"
          title="Comments whose element could no longer be found"
        >
          {detachedCount} detached
        </span>
      )}
    </div>
  );
}
