/**
 * Red-pen drawing overlay for the mockup preview.
 *
 * Extracted from MockupEditor unchanged in behaviour: the canvas is sized to
 * the iframe, strokes are kept in document coordinates and re-drawn against
 * the frame's scroll offset, and leaving drawing mode snapshots the canvas to
 * a data URL for the AI-annotation payload. These strokes are ephemeral by
 * design -- they are an AI prompt affordance, not a persisted annotation.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  type WheelEvent as ReactWheelEvent,
} from "react";
import type { DrawingPath } from "@nimbalyst/runtime";

export interface UseMockupDrawingOptions {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  /** Called when a stroke starts, so the editor can stamp the annotation time. */
  onStroke: () => void;
}

export function useMockupDrawing({ iframeRef, onStroke }: UseMockupDrawingOptions) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const drawingPathsRef = useRef<DrawingPath[]>([]);
  const onStrokeRef = useRef(onStroke);
  onStrokeRef.current = onStroke;

  const [drawingDataUrl, setDrawingDataUrl] = useState<string | null>(null);
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [drawingColor, setDrawingColor] = useState("#FF0000");
  const [scrollOffset, setScrollOffset] = useState({ x: 0, y: 0 });

  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    drawingPathsRef.current.forEach((path) => {
      if (path.points.length < 2) return;

      ctx.strokeStyle = path.color;
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      ctx.beginPath();
      const firstPoint = path.points[0];
      ctx.moveTo(firstPoint.x - scrollOffset.x, firstPoint.y - scrollOffset.y);

      for (let i = 1; i < path.points.length; i++) {
        const point = path.points[i];
        ctx.lineTo(point.x - scrollOffset.x, point.y - scrollOffset.y);
      }
      ctx.stroke();
    });
  }, [scrollOffset]);

  /** Clear strokes without leaving drawing mode. */
  const clearDrawing = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawingPathsRef.current = [];
    setDrawingDataUrl(null);
  }, []);

  /** Drop every stroke. Stable identity: the editor's clear-all depends on it. */
  const reset = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx && canvasRef.current) {
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
    drawingPathsRef.current = [];
    setDrawingDataUrl(null);
  }, []);

  const setDrawingMode = useCallback((next: boolean) => {
    setIsDrawingMode((prev) => {
      if (prev === next) return prev;
      if (!next) {
        const canvas = canvasRef.current;
        if (canvas) setDrawingDataUrl(canvas.toDataURL("image/png"));
      }
      return next;
    });
  }, []);

  const toggleDrawingMode = useCallback(() => {
    setDrawingMode(!isDrawingMode);
  }, [isDrawingMode, setDrawingMode]);

  const handleMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLCanvasElement>) => {
      if (!isDrawingMode) return;

      const canvas = canvasRef.current;
      if (!canvas || canvas.width === 0 || canvas.height === 0) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left + scrollOffset.x;
      const y = e.clientY - rect.top + scrollOffset.y;

      isDrawingRef.current = true;
      lastPointRef.current = { x, y };
      onStrokeRef.current();

      drawingPathsRef.current.push({ points: [{ x, y }], color: drawingColor });
    },
    [isDrawingMode, scrollOffset, drawingColor]
  );

  const handleMouseMove = useCallback(
    (e: ReactMouseEvent<HTMLCanvasElement>) => {
      if (!isDrawingMode || !isDrawingRef.current) return;

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left + scrollOffset.x;
      const y = e.clientY - rect.top + scrollOffset.y;

      if (lastPointRef.current && drawingPathsRef.current.length > 0) {
        const currentPath =
          drawingPathsRef.current[drawingPathsRef.current.length - 1];
        currentPath.points.push({ x, y });

        ctx.strokeStyle = drawingColor;
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        ctx.beginPath();
        ctx.moveTo(
          lastPointRef.current.x - scrollOffset.x,
          lastPointRef.current.y - scrollOffset.y
        );
        ctx.lineTo(x - scrollOffset.x, y - scrollOffset.y);
        ctx.stroke();
      }

      lastPointRef.current = { x, y };
    },
    [isDrawingMode, drawingColor, scrollOffset]
  );

  const handleMouseUp = useCallback(() => {
    isDrawingRef.current = false;
    lastPointRef.current = null;

    const canvas = canvasRef.current;
    if (canvas) setDrawingDataUrl(canvas.toDataURL("image/png"));
  }, []);

  const handleMouseLeave = useCallback(() => {
    isDrawingRef.current = false;
    lastPointRef.current = null;
  }, []);

  const handleWheel = useCallback(
    (e: ReactWheelEvent<HTMLCanvasElement>) => {
      if (!isDrawingMode) return;
      const iframeDoc = iframeRef.current?.contentDocument;
      if (!iframeDoc) return;
      iframeDoc.documentElement.scrollTop += e.deltaY;
      iframeDoc.documentElement.scrollLeft += e.deltaX;
    },
    [isDrawingMode, iframeRef]
  );

  // Keep the canvas the size of the frame, and track the frame's scroll so
  // strokes stay glued to the content they were drawn over.
  useEffect(() => {
    const iframe = iframeRef.current;
    const canvas = canvasRef.current;
    if (!iframe || !canvas) return;

    const updateCanvasSize = () => {
      const width = iframe.offsetWidth;
      const height = iframe.offsetHeight;
      if (width > 0 && height > 0) {
        canvas.width = width;
        canvas.height = height;
        redrawCanvas();
      }
    };

    updateCanvasSize();

    let drawModeTimeoutId: ReturnType<typeof setTimeout> | null = null;
    if (isDrawingMode) {
      drawModeTimeoutId = setTimeout(updateCanvasSize, 100);
    }

    const iframeDoc = iframe.contentDocument;
    const handleScroll = () => {
      if (!iframeDoc) return;
      setScrollOffset({
        x: iframeDoc.documentElement.scrollLeft || iframeDoc.body.scrollLeft,
        y: iframeDoc.documentElement.scrollTop || iframeDoc.body.scrollTop,
      });
    };

    iframeDoc?.addEventListener("scroll", handleScroll);
    window.addEventListener("resize", updateCanvasSize);

    return () => {
      if (drawModeTimeoutId) clearTimeout(drawModeTimeoutId);
      iframeDoc?.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", updateCanvasSize);
    };
  }, [isDrawingMode, redrawCanvas, iframeRef]);

  useEffect(() => {
    redrawCanvas();
  }, [scrollOffset, redrawCanvas]);

  return {
    canvasRef,
    drawingPathsRef,
    drawingDataUrl,
    isDrawingMode,
    drawingColor,
    setDrawingColor,
    setDrawingMode,
    toggleDrawingMode,
    clearDrawing,
    reset,
    canvasHandlers: {
      onMouseDown: handleMouseDown,
      onMouseMove: handleMouseMove,
      onMouseUp: handleMouseUp,
      onMouseLeave: handleMouseLeave,
      onWheel: handleWheel,
    },
  };
}

export type MockupDrawing = ReturnType<typeof useMockupDrawing>;
