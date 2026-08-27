import { useEffect, useMemo, useState, type ReactElement } from "react";
import type { EditorHost, EditorHostProps } from "@nimbalyst/runtime";
import { MockupProjectCollabContentAdapter } from "@nimbalyst/mockuplm/collab-adapters";
import { CanvasEditor } from "@nimbalyst/runtime/canvas/CanvasEditor";

import {
  MockupProjectConversionError,
  canvasPathForMockupProject,
  convertMockupProjectFile,
  convertMockupProjectSource,
} from "./mockupProjectConversion";

type PreviewState =
  | { kind: "loading" }
  | { kind: "ready"; canvasContent: string; revision: number }
  | { kind: "error"; message: string };

type ConversionState =
  | { kind: "idle" }
  | { kind: "converting" }
  | { kind: "converted"; targetPath: string }
  | { kind: "error"; message: string };

function sourceText(value: string | Uint8Array): string {
  return typeof value === "string"
    ? value
    : new TextDecoder("utf-8").decode(value);
}

function previewFileName(sourceName: string): string {
  return /\.mockupproject$/i.test(sourceName)
    ? sourceName.replace(/\.mockupproject$/i, ".canvas")
    : `${sourceName}.canvas`;
}

function readOnlyCanvasHost(
  sourceHost: EditorHost,
  canvasContent: string
): EditorHost {
  return {
    ...sourceHost,
    fileName: previewFileName(sourceHost.fileName),
    readOnly: true,
    collaboration: undefined,
    loadContent: async () => canvasContent,
    onFileChanged: () => () => {},
    setDirty: () => {},
    saveContent: async () => {
      throw new Error("The mockup project compatibility preview is read-only.");
    },
    onSaveRequested: () => () => {},
    onReadOnlyChanged: undefined,
  };
}

function errorMessage(cause: unknown): string {
  if (cause instanceof MockupProjectConversionError) return cause.message;
  const detail = cause instanceof Error ? cause.message : String(cause);
  return `Conversion failed: ${detail}. The original mockup project was not modified.`;
}

/**
 * Read-only bridge for retired `.mockupproject` documents.
 *
 * Local projects are parsed through the pure converter and shown on the real
 * Project Canvas surface. Already-shared projects read their legacy Y.Doc via
 * the retained codec, then project that same data into the read-only surface.
 * Neither open path writes the source.
 */
export function MockupProjectCompatibilityEditor({
  host,
}: EditorHostProps): ReactElement {
  const [preview, setPreview] = useState<PreviewState>({ kind: "loading" });
  const [conversion, setConversion] = useState<ConversionState>({
    kind: "idle",
  });

  useEffect(() => {
    let cancelled = false;
    let revision = 0;

    const publish = (legacySource: string) => {
      try {
        const canvasContent = convertMockupProjectSource(legacySource);
        if (!cancelled) {
          revision += 1;
          setPreview({ kind: "ready", canvasContent, revision });
        }
      } catch (cause) {
        if (!cancelled) {
          setPreview({
            kind: "error",
            message: errorMessage(cause),
          });
        }
      }
    };

    if (host.collaboration) {
      const yDoc = host.collaboration.yDoc;
      const publishShared = () => {
        publish(
          sourceText(MockupProjectCollabContentAdapter.exportToFile(yDoc))
        );
      };
      publishShared();
      yDoc.on("update", publishShared);
      return () => {
        cancelled = true;
        yDoc.off("update", publishShared);
      };
    }

    void host
      .loadContent()
      .then(publish)
      .catch((cause: unknown) => {
        if (!cancelled) {
          setPreview({ kind: "error", message: errorMessage(cause) });
        }
      });
    const unsubscribe = host.onFileChanged(publish);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [host]);

  const canvasHost = useMemo(
    () =>
      preview.kind === "ready"
        ? readOnlyCanvasHost(host, preview.canvasContent)
        : null,
    [host, preview]
  );

  const handleConvert = async () => {
    if (!host.fs || host.collaboration) return;
    setConversion({ kind: "converting" });
    try {
      const result = await convertMockupProjectFile(host.fs, host.filePath);
      setConversion({ kind: "converted", targetPath: result.targetPath });

      if (host.workspaceId && window.electronAPI?.invoke) {
        void window.electronAPI
          .invoke("workspace:open-file", {
            workspacePath: host.workspaceId,
            filePath: result.targetPath,
          })
          .catch((cause: unknown) => {
            console.error(
              "[MockupProjectCompatibilityEditor] Converted canvas could not be opened",
              cause
            );
          });
      }
    } catch (cause) {
      setConversion({ kind: "error", message: errorMessage(cause) });
    }
  };

  const targetPath = host.collaboration
    ? null
    : canvasPathForMockupProject(host.filePath);

  return (
    <div
      className="mockup-project-compatibility-editor flex h-full min-h-0 flex-col bg-nim text-nim"
      data-read-only="true"
    >
      <div className="mockup-project-compatibility-editor__notice flex shrink-0 items-center gap-3 border-b border-nim bg-nim-secondary px-4 py-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Legacy Mockup Project</div>
          <div className="text-xs text-nim-muted">
            {host.collaboration
              ? "This shared project is open read-only for compatibility. Its shared document remains unchanged."
              : "This file is open read-only. Convert it to Project Canvas to keep working; the original file remains unchanged."}
          </div>
        </div>
        {!host.collaboration && host.fs ? (
          <button
            type="button"
            className="mockup-project-compatibility-editor__convert shrink-0 rounded border border-nim bg-nim px-3 py-1.5 text-xs font-medium text-nim hover:bg-nim-hover disabled:cursor-wait disabled:opacity-60"
            disabled={conversion.kind === "converting"}
            onClick={() => void handleConvert()}
          >
            {conversion.kind === "converting"
              ? "Converting..."
              : "Convert to canvas"}
          </button>
        ) : null}
      </div>

      {conversion.kind === "converted" ? (
        <div className="mockup-project-compatibility-editor__status shrink-0 border-b border-nim px-4 py-2 text-xs text-nim-muted">
          Created {conversion.targetPath}. The original project was not changed.
        </div>
      ) : conversion.kind === "error" ? (
        <div className="mockup-project-compatibility-editor__error shrink-0 border-b border-nim px-4 py-2 text-xs text-nim-error">
          {conversion.message}
        </div>
      ) : targetPath ? (
        <div className="mockup-project-compatibility-editor__target sr-only">
          Conversion target: {targetPath}
        </div>
      ) : null}

      <div className="min-h-0 flex-1">
        {preview.kind === "loading" ? (
          <div className="flex h-full items-center justify-center text-sm text-nim-muted">
            Loading project preview...
          </div>
        ) : preview.kind === "error" ? (
          <div className="flex h-full items-center justify-center p-6">
            <div className="max-w-xl text-sm text-nim-error">
              {preview.message}
            </div>
          </div>
        ) : canvasHost ? (
          <CanvasEditor key={preview.revision} host={canvasHost} />
        ) : null}
      </div>
    </div>
  );
}
