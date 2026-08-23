import React from "react";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Doc as YDoc } from "yjs";
import type { CollaborationCommentsService } from "@nimbalyst/extension-sdk";

vi.mock("@nimbalyst/extension-sdk", async () => {
  const actual = await vi.importActual<
    typeof import("@nimbalyst/extension-sdk")
  >("@nimbalyst/extension-sdk");
  return {
    ...actual,
    useEditorLifecycle: () => ({
      markDirty: vi.fn(),
      isLoading: false,
      error: null,
      theme: "dark",
      diffState: null,
    }),
    useCollaborativeEditor: vi.fn(),
  };
});

import { MockupEditor } from "../components/MockupEditor";

function stubHost(extra: Record<string, unknown> = {}) {
  return {
    filePath: "/workspace/dashboard.mockup.html",
    fileName: "dashboard.mockup.html",
    isActive: false,
    readOnly: false,
    registerEditorAPI: vi.fn(),
    onReadOnlyChanged: vi.fn(() => () => undefined),
    onThemeChanged: vi.fn(() => () => undefined),
    onSaveRequested: vi.fn(() => () => undefined),
    onDiffRequested: vi.fn(() => () => undefined),
    onContentChanged: vi.fn(() => () => undefined),
    loadContent: vi.fn(async () => "<html><body>Dashboard</body></html>"),
    saveContent: vi.fn(async () => undefined),
    setDirty: vi.fn(),
    reportDiffResult: vi.fn(),
    ...extra,
  } as never;
}

function stubCanvas(): void {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
  } as never);
}

describe("MockupEditor editor API", () => {
  it("registers readiness for hidden-editor tools and unregisters on unmount", () => {
    stubCanvas();
    const registerEditorAPI = vi.fn();
    const host = stubHost({ registerEditorAPI });

    const view = render(<MockupEditor host={host} />);

    expect(registerEditorAPI).toHaveBeenCalledWith(
      expect.objectContaining({
        getCurrentHtml: expect.any(Function),
        exportToPngBlob: expect.any(Function),
      })
    );

    view.unmount();
    expect(registerEditorAPI).toHaveBeenLastCalledWith(null);
  });
});

/**
 * The comments panel is the platform's, docked beside this editor by the host.
 * A mockup that mounts one of its own puts two identical panels on screen for
 * the same document -- two Reply boxes, two Resolve buttons, per thread.
 */
describe("MockupEditor comments surface", () => {
  function commentsService(): CollaborationCommentsService {
    return {
      getSnapshot: () => Object.freeze([]),
      subscribe: () => () => undefined,
      getCapabilities: () => ({ read: true, comment: true }),
      getMentionableMembers: () => [],
      createThread: vi.fn(),
      reply: vi.fn(),
      setResolved: vi.fn(async () => undefined),
      focusThread: vi.fn(async () => true),
      openPanel: vi.fn(),
      registerAnchorAdapter: () => () => undefined,
    } as unknown as CollaborationCommentsService;
  }

  it("mounts no comments panel of its own, even in comment mode", () => {
    stubCanvas();
    const service = commentsService();
    const host = stubHost({
      collaboration: {
        yDoc: new YDoc(),
        comments: service,
        user: { id: "user-1", name: "Ada" },
      },
    });

    const { container } = render(<MockupEditor host={host} />);

    // Entering comment mode is the moment the editor's own pane used to appear.
    const toggle = container.querySelector<HTMLButtonElement>(
      ".mockup-comment-mode-toggle"
    );
    fireEvent.click(toggle!);

    expect(container.querySelectorAll(".nim-comments-panel")).toHaveLength(0);
    // The pins overlay is the extension's half and stays.
    expect(container.querySelector(".mockup-comment-overlay")).not.toBeNull();
  });
});
