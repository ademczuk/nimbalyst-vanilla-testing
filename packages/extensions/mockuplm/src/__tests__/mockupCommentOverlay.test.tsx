import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMockupPinLayout } from "../components/comments/useMockupPinLayout";
import { useMockupComments } from "../components/comments/useMockupComments";
import { useMockupInteractionMode } from "../components/useMockupInteractionMode";
import { createInMemoryMockupPinStore } from "../comments/mockupPinStore";
import type { MockupPin } from "../collab/seed";

const PIN: MockupPin = {
  id: "pin-1",
  selector: "#save",
  labelSnapshot: "button:Save changes",
  offset: { xPct: 0.5, yPct: 0.5 },
  viewport: { width: 1440, label: "Desktop" },
  createdAt: 100,
  createdBy: "user-1",
};

/** A live same-origin frame, plus a rect the test can move under the overlay. */
function mountFrame() {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  const frameDocument = iframe.contentDocument!;
  frameDocument.body.innerHTML = '<button id="save">Save changes</button>';

  const rect = { left: 0, top: 0, width: 100, height: 40 };
  const target = frameDocument.querySelector("#save")!;
  target.getBoundingClientRect = () =>
    ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
    }) as DOMRect;

  return { iframe, frameDocument, rect };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("pin overlay measurement", () => {
  it("re-measures on a content version bump, a viewport change, a resize, and a scroll", () => {
    const { iframe, frameDocument, rect } = mountFrame();
    const store = createInMemoryMockupPinStore();
    store.create(PIN);
    const iframeRef = { current: iframe };

    const { result, rerender } = renderHook(
      (props: { contentVersion: number; viewportWidth: number | null }) =>
        useMockupPinLayout({ iframeRef, store, ...props }),
      {
        initialProps: { contentVersion: 1, viewportWidth: null } as {
          contentVersion: number;
          viewportWidth: number | null;
        },
      }
    );

    const positionOfPin = () => {
      const [placement] = result.current.placements;
      return { left: placement?.left, top: placement?.top };
    };
    expect(positionOfPin()).toEqual({ left: 50, top: 20 });

    rect.left = 200;
    act(() => rerender({ contentVersion: 2, viewportWidth: null }));
    expect(positionOfPin()).toEqual({ left: 250, top: 20 });

    rect.left = 400;
    act(() => rerender({ contentVersion: 2, viewportWidth: 768 }));
    expect(positionOfPin()).toEqual({ left: 450, top: 20 });

    rect.left = 600;
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(positionOfPin()).toEqual({ left: 650, top: 20 });

    rect.top = 300;
    act(() => {
      frameDocument.dispatchEvent(new Event("scroll"));
    });
    expect(positionOfPin()).toEqual({ left: 650, top: 320 });
  });

  it("re-measures a scroll without re-resolving, but re-resolves a target that left the document", () => {
    const { iframe, frameDocument, rect } = mountFrame();
    const store = createInMemoryMockupPinStore();
    store.create(PIN);
    const iframeRef = { current: iframe };

    // Selector queries and computed style are the expensive half. On a long
    // mockup they would run per ancestor per pin on every scroll event.
    const querySpy = vi.spyOn(frameDocument, "querySelectorAll");
    const styleSpy = vi.spyOn(frameDocument.defaultView!, "getComputedStyle");

    const { result } = renderHook(() =>
      useMockupPinLayout({ iframeRef, store, viewportWidth: null, contentVersion: 1 })
    );
    expect(querySpy).toHaveBeenCalled();

    querySpy.mockClear();
    styleSpy.mockClear();
    rect.top = 400;
    act(() => {
      frameDocument.dispatchEvent(new Event("scroll"));
    });
    expect(result.current.placements[0].top).toBe(420);
    expect(querySpy).not.toHaveBeenCalled();
    expect(styleSpy).not.toHaveBeenCalled();

    // A rebuilt DOM makes the held target's rect meaningless, so the next
    // measurement has to resolve again rather than read it.
    frameDocument.body.innerHTML = '<button id="save">Save changes</button>';
    const replacement = frameDocument.querySelector("#save")!;
    replacement.getBoundingClientRect = () =>
      ({ left: 8, top: 8, width: 40, height: 20, right: 48, bottom: 28 }) as DOMRect;

    act(() => {
      frameDocument.dispatchEvent(new Event("scroll"));
    });
    expect(querySpy).toHaveBeenCalled();
    expect(result.current.placements[0]).toMatchObject({ left: 28, top: 18 });

    querySpy.mockRestore();
    styleSpy.mockRestore();
  });

  it("stops measuring once the frame is gone", () => {
    const { iframe } = mountFrame();
    const store = createInMemoryMockupPinStore();
    store.create(PIN);
    const iframeRef: { current: HTMLIFrameElement | null } = { current: iframe };

    const { result, rerender } = renderHook(
      (props: { contentVersion: number }) =>
        useMockupPinLayout({ iframeRef, store, viewportWidth: null, ...props }),
      { initialProps: { contentVersion: 1 } }
    );
    expect(result.current.placements).toHaveLength(1);

    iframeRef.current = null;
    act(() => rerender({ contentVersion: 2 }));
    expect(result.current.placements).toEqual([]);
  });
});

describe("comment wiring without a host comments service", () => {
  it("degrades to no commenting instead of simulating it locally", () => {
    const { iframe } = mountFrame();
    const iframeRef = { current: iframe };

    const { result } = renderHook(() =>
      useMockupComments({
        yDoc: null,
        // The host predates collaborative comments, or the document is not in
        // a room. Either way there is nowhere shared to put a thread.
        service: undefined,
        user: { id: "user-1", name: "Ada" },
        iframeRef,
        canPlace: true,
      })
    );

    // No source at all -- not an in-memory stand-in that would look shared and
    // silently is not.
    expect(result.current.source).toBeNull();
    // Pins still have a home, because a shared doc can carry a peer's pins.
    expect(result.current.store.snapshot()).toEqual([]);
    act(() => result.current.store.create(PIN));
    expect(result.current.store.snapshot()).toHaveLength(1);
  });
});

describe("mockup interaction modes", () => {
  it("never leaves comment mode and interactive mode both active", () => {
    const onLeaveSelectMode = vi.fn();
    const onEnterCommentMode = vi.fn();
    const { result } = renderHook(() =>
      useMockupInteractionMode({
        isReadOnlyViewer: false,
        onLeaveSelectMode,
        onEnterCommentMode,
      })
    );

    act(() => result.current.toggleCommentMode());
    expect(result.current).toMatchObject({ isCommentMode: true, isInteractive: false });
    // Comment mode is the third claim on the same clicks, so drawing ends too.
    expect(onEnterCommentMode).toHaveBeenCalledTimes(1);

    act(() => result.current.toggleInteractive());
    expect(result.current).toMatchObject({ isCommentMode: false, isInteractive: true });

    act(() => result.current.toggleCommentMode());
    expect(result.current).toMatchObject({ isCommentMode: true, isInteractive: false });

    act(() => result.current.exitCommentMode());
    expect(result.current).toMatchObject({ isCommentMode: false, isInteractive: false });
  });

  it("forces a read-only surface to interactive with no comment placement", () => {
    const { result, rerender } = renderHook(
      ({ isReadOnlyViewer }: { isReadOnlyViewer: boolean }) =>
        useMockupInteractionMode({
          isReadOnlyViewer,
          onLeaveSelectMode: () => undefined,
          onEnterCommentMode: () => undefined,
        }),
      { initialProps: { isReadOnlyViewer: false } }
    );

    act(() => result.current.toggleCommentMode());
    expect(result.current.isCommentMode).toBe(true);

    act(() => rerender({ isReadOnlyViewer: true }));
    expect(result.current).toMatchObject({ isCommentMode: false, isInteractive: true });
  });
});
