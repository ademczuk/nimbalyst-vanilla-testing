/**
 * Core editors that register into the custom-editor registry.
 *
 * Until now only `ExtensionEditorBridge` wrote to this registry, but TabEditor
 * has always had a branch for a registration with no `extensionId` (it renders
 * the component directly and falls back to a no-op extension storage), so a
 * core editor claiming a file type is the anticipated path rather than a new
 * seam. Registering here gets TabEditor's existing plumbing -- load, save,
 * dirty state, the file watcher, source mode -- for free.
 *
 * The surface is loaded lazily: `@xyflow/react` and the whole card tree have no
 * business in the renderer's initial bundle when most windows never open a
 * board. (`@xyflow/react` is pinned in the renderer's `optimizeDeps.include`
 * for exactly this reason -- a lazily *discovered* dep triggers a mid-session
 * re-optimize and a second React instance.)
 */

import { Suspense, lazy } from "react";
import type { EditorHostProps } from "@nimbalyst/runtime";

import { customEditorRegistry } from "./registry";

const CanvasEditor = lazy(async () => ({
  default: (await import("@nimbalyst/runtime/canvas/CanvasEditor"))
    .CanvasEditor,
}));

const MockupProjectCompatibilityEditor = lazy(async () => ({
  default: (await import("./MockupProjectCompatibilityEditor"))
    .MockupProjectCompatibilityEditor,
}));

function ProjectCanvasEditor(props: EditorHostProps) {
  return (
    // A distinct modifier from the editor's own loading state, so "the chunk
    // never arrived" and "the file has not been read yet" are tellable apart in
    // the DOM.
    <Suspense
      fallback={<div className="canvas-editor canvas-editor--pending" />}
    >
      <CanvasEditor {...props} />
    </Suspense>
  );
}

function LegacyMockupProjectEditor(props: EditorHostProps) {
  return (
    <Suspense
      fallback={
        <div className="mockup-project-compatibility-editor mockup-project-compatibility-editor--pending" />
      }
    >
      <MockupProjectCompatibilityEditor {...props} />
    </Suspense>
  );
}

export function registerBuiltinCustomEditors(): void {
  if (
    customEditorRegistry.getRegistration(".canvas")?.component !==
    ProjectCanvasEditor
  ) {
    customEditorRegistry.register({
      extensions: [".canvas"],
      component: ProjectCanvasEditor,
      name: "Project Canvas",
      extensionId: "builtin.canvas",
      componentName: "ProjectCanvasEditor",
      // A `.canvas` file is JSON, so the host's Monaco source view is a free and
      // genuinely useful escape hatch when a board will not open.
      supportsSourceMode: true,
      showDocumentHeader: false,
      collaboration: {
        supported: true,
        awarenessFields: ["canvas"],
      },
    });
  }

  if (
    customEditorRegistry.getRegistration(".mockupproject")?.component !==
    LegacyMockupProjectEditor
  ) {
    customEditorRegistry.register({
      extensions: [".mockupproject"],
      component: LegacyMockupProjectEditor,
      name: "Legacy Mockup Project",
      // Existing shared documents record this historical editor id. Retaining
      // it here lets CollaborativeTabEditor bind the compatibility reader to
      // those rooms after the extension contribution itself is removed.
      extensionId: "com.nimbalyst.mockuplm",
      componentName: "MockupProjectCompatibilityEditor",
      supportsSourceMode: false,
      showDocumentHeader: false,
      collaboration: {
        supported: true,
        awarenessFields: [],
      },
    });
  }
}
