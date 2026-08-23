/**
 * One numbered pin drawn above the mockup frame, with a hover card carrying
 * the author, the relative time, and the thread's first line.
 *
 * Positioning is @floating-ui/react against a virtual reference at the pin's
 * own coordinates, so the card flips and shifts at the viewport edges instead
 * of being clipped -- and renders through FloatingPortal so the frame's
 * overflow cannot swallow it.
 */

import { useMemo, useState } from "react";
import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useFloating,
  useHover,
  useInteractions,
  useRole,
} from "@floating-ui/react";
// The one author-color implementation in the tree. The host resolves this
// specifier through its import map, so the extension shares the exact palette
// the document pane draws with -- the same teammate is the same color on a
// mockup pin and on a document comment.
import {
  AUTHOR_COLOR_FOREGROUND,
  authorColor,
  authorInitial,
} from "@nimbalyst/runtime/editor/commenting/ui";
import type { MockupCommentThread } from "../../comments/mockupCommentSource";
import type { MockupPinPlacement } from "../../comments/measureMockupPins";
import { formatRelativeTime } from "./relativeTime";

export const PIN_DIAMETER = 24;

export interface MockupCommentPinProps {
  placement: MockupPinPlacement;
  /** Deterministic display number, shared by every client. */
  number: number;
  thread: MockupCommentThread | undefined;
  /** True while this pin's thread is the one selected in the panel. */
  isActive?: boolean;
  onSelect?: (pinId: string) => void;
}

export function MockupCommentPin({
  placement,
  number,
  thread,
  isActive = false,
  onSelect,
}: MockupCommentPinProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { pin } = placement;
  const authorUserId = thread?.authorUserId ?? pin.createdBy;
  const color = authorColor(authorUserId);

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: "top",
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useHover(context, { delay: { open: 80, close: 60 } }),
    useRole(context, { role: "tooltip" }),
  ]);

  const label = useMemo(() => {
    const author = thread?.authorName ?? "Unknown author";
    return `Comment ${number} by ${author}`;
  }, [number, thread?.authorName]);

  return (
    <>
      <button
        ref={refs.setReference}
        {...getReferenceProps({
          type: "button",
          className: isActive
            ? "mockup-comment-pin mockup-comment-pin-active"
            : "mockup-comment-pin",
          "aria-label": label,
          "aria-current": isActive ? ("true" as const) : undefined,
          onClick: () => onSelect?.(pin.id),
          style: {
            position: "absolute",
            left: placement.left,
            top: placement.top,
            width: PIN_DIAMETER,
            height: PIN_DIAMETER,
            marginLeft: -PIN_DIAMETER / 2,
            marginTop: -PIN_DIAMETER,
            borderRadius: `${PIN_DIAMETER}px ${PIN_DIAMETER}px ${PIN_DIAMETER}px 2px`,
            background: color,
            color: AUTHOR_COLOR_FOREGROUND,
            border: "1px solid rgba(255, 255, 255, 0.65)",
            boxShadow: isActive
              ? `0 2px 6px rgba(0, 0, 0, 0.35), 0 0 0 3px ${color}66`
              : "0 2px 6px rgba(0, 0, 0, 0.35)",
            fontSize: 11,
            fontWeight: 700,
            lineHeight: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            pointerEvents: "auto",
            padding: 0,
          },
        })}
      >
        {number}
        <span
          className="mockup-comment-pin-initial"
          aria-hidden="true"
          style={{
            position: "absolute",
            right: -4,
            bottom: -4,
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: AUTHOR_COLOR_FOREGROUND,
            color,
            border: `1px solid ${color}`,
            fontSize: 8,
            fontWeight: 700,
            lineHeight: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {authorInitial(thread?.authorName ?? "", authorUserId)}
        </span>
      </button>
      {isOpen && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            {...getFloatingProps({
              className:
                "mockup-comment-pin-card max-w-xs rounded-md border border-nim bg-nim-secondary px-3 py-2 text-xs text-nim shadow-lg select-text",
              style: { ...floatingStyles, zIndex: 2000 },
            })}
          >
            <div className="flex items-center gap-2">
              <span
                className="mockup-comment-pin-avatar flex items-center justify-center rounded-full"
                style={{
                  width: 16,
                  height: 16,
                  background: color,
                  color: AUTHOR_COLOR_FOREGROUND,
                  fontSize: 9,
                  fontWeight: 700,
                }}
              >
                {authorInitial(thread?.authorName ?? "", authorUserId)}
              </span>
              <span className="font-medium">
                {thread?.authorName ?? "Unknown author"}
              </span>
              <span className="text-nim-faint">
                {formatRelativeTime(thread?.createdAt ?? pin.createdAt)}
              </span>
            </div>
            <p className="mt-1 text-nim-muted">
              {thread?.preview ?? "No comment text yet"}
            </p>
            {thread && thread.replyCount > 0 && (
              <p className="mt-1 text-nim-faint">
                {thread.replyCount} {thread.replyCount === 1 ? "reply" : "replies"}
              </p>
            )}
            {pin.selector === null && (
              <p className="mt-1 text-nim-faint">
                Placed at {pin.viewport.label} {pin.viewport.width}
              </p>
            )}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
