/**
 * Screenshot capture for the mockup preview: the toolbar's copy-to-clipboard
 * action, and the MCP `mockup:capture-screenshot` request handler.
 *
 * Extracted from MockupEditor unchanged. The MCP half is Electron-only and
 * stays no-op where `window.electronAPI` is absent (the web console).
 */

import { useCallback, useEffect, useState, type RefObject } from "react";
import type { DrawingPath } from "@nimbalyst/runtime";
import {
  captureMockupComposite,
  describeScreenshotCaptureError,
  sanitizeScreenshotCloneForXml,
} from "../utils/screenshotUtils";

export interface UseMockupScreenshotOptions {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  filePath: string;
  fileName: string;
  drawingPathsRef: RefObject<DrawingPath[]>;
}

export function useMockupScreenshot({
  iframeRef,
  filePath,
  fileName,
  drawingPathsRef,
}: UseMockupScreenshotOptions) {
  const [isCapturing, setIsCapturing] = useState(false);

  useEffect(() => {
    const electronAPI = window.electronAPI;
    if (!electronAPI?.on || !electronAPI?.invoke) return;

    const handleCaptureRequest = async (data: {
      requestId: string;
      filePath: string;
    }) => {
      if (data.filePath !== filePath) return;

      console.log("[MockupEditor] Received MCP screenshot request");

      try {
        if (!iframeRef.current) {
          throw new Error("Iframe not ready");
        }

        const paths =
          drawingPathsRef.current.length > 0 ? drawingPathsRef.current : undefined;
        const imageBase64 = await captureMockupComposite(
          iframeRef.current,
          null,
          paths
        );

        await electronAPI.invoke("mockup:screenshot-result", {
          requestId: data.requestId,
          success: true,
          imageBase64,
          mimeType: "image/png",
        });
      } catch (err) {
        await electronAPI.invoke("mockup:screenshot-result", {
          requestId: data.requestId,
          success: false,
          error: describeScreenshotCaptureError(err),
        });
      }
    };

    return electronAPI.on("mockup:capture-screenshot", handleCaptureRequest);
  }, [filePath, iframeRef, drawingPathsRef]);

  const captureScreenshot = useCallback(async () => {
    if (!iframeRef.current) {
      alert("Screenshot failed: iframe not ready");
      return;
    }

    setIsCapturing(true);

    try {
      const iframe = iframeRef.current;
      const iframeWindow = iframe.contentWindow;
      const iframeDoc = iframe.contentDocument || iframeWindow?.document;

      if (!iframeDoc || !iframeDoc.body) {
        throw new Error("Cannot access iframe document");
      }

      if (iframeDoc.readyState !== "complete") {
        await new Promise((resolve) => {
          iframeWindow?.addEventListener("load", resolve, { once: true });
          setTimeout(resolve, 5000);
        });
      }

      const html2canvas = (await import("html2canvas")).default;
      const targetElement = iframeDoc.body;
      const elemWidth =
        targetElement.scrollWidth ||
        targetElement.offsetWidth ||
        iframe.offsetWidth;
      const elemHeight =
        targetElement.scrollHeight ||
        targetElement.offsetHeight ||
        iframe.offsetHeight;

      if (elemWidth === 0 || elemHeight === 0) {
        throw new Error("Target element has zero dimensions");
      }

      const canvas = await html2canvas(targetElement, {
        backgroundColor: "#ffffff",
        scale: 2,
        logging: false,
        useCORS: false,
        allowTaint: true,
        foreignObjectRendering: true,
        imageTimeout: 0,
        width: elemWidth,
        height: elemHeight,
        windowWidth: elemWidth,
        windowHeight: elemHeight,
        onclone: sanitizeScreenshotCloneForXml,
      });

      canvas.toBlob(async (blob) => {
        if (!blob) {
          throw new Error("Failed to create image blob");
        }

        try {
          await navigator.clipboard.write([
            new ClipboardItem({ "image/png": blob }),
          ]);
          const notification = document.createElement("div");
          notification.textContent = "Screenshot copied to clipboard";
          notification.style.cssText = `
            position: fixed;
            top: 60px;
            right: 20px;
            background: var(--nim-bg-secondary);
            border: 1px solid var(--nim-border);
            color: var(--nim-text);
            padding: 12px 20px;
            border-radius: 6px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            z-index: 10000;
            font-size: 14px;
          `;
          document.body.appendChild(notification);
          setTimeout(() => notification.remove(), 3000);
        } catch {
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          const timestamp = new Date()
            .toISOString()
            .replace(/[:.]/g, "-")
            .slice(0, -5);
          a.href = url;
          a.download = `${fileName.replace(
            ".mockup.html",
            ""
          )}-screenshot-${timestamp}.png`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }
      }, "image/png");
    } catch (err) {
      console.error("[MockupEditor] Screenshot capture failed:", err);
      alert("Failed to capture screenshot: " + describeScreenshotCaptureError(err));
    } finally {
      setIsCapturing(false);
    }
  }, [fileName, iframeRef]);

  return { isCapturing, captureScreenshot };
}
