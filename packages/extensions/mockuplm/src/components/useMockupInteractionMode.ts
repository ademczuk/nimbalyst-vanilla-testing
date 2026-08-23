/**
 * Which pointer mode the mockup preview is in.
 *
 * Select, Interactive, and Comment all want the same clicks for different
 * purposes, so at most one can be active. Element picking already followed
 * that rule against Interactive mode; Comment mode joins the same machine
 * rather than adding a second, quietly divergent one.
 *
 * Select mode is the absence of the other two.
 */

import { useCallback, useEffect, useState } from "react";

export interface UseMockupInteractionModeOptions {
  /** Read-only surfaces are Interactive-only: no picking, no placement. */
  isReadOnlyViewer: boolean;
  /** Leave any element selection behind when picking stops being the mode. */
  onLeaveSelectMode: () => void;
  /** Drawing is a third claim on the same clicks; entering comment mode ends it. */
  onEnterCommentMode: () => void;
}

export interface MockupInteractionMode {
  isInteractive: boolean;
  isCommentMode: boolean;
  toggleInteractive: () => void;
  toggleCommentMode: () => void;
  exitCommentMode: () => void;
}

export function useMockupInteractionMode({
  isReadOnlyViewer,
  onLeaveSelectMode,
  onEnterCommentMode,
}: UseMockupInteractionModeOptions): MockupInteractionMode {
  const [isInteractive, setIsInteractive] = useState(isReadOnlyViewer);
  const [isCommentMode, setIsCommentMode] = useState(false);

  const toggleInteractive = useCallback(() => {
    setIsInteractive((wasInteractive) => !wasInteractive);
    if (!isInteractive) {
      setIsCommentMode(false);
      onLeaveSelectMode();
    }
  }, [isInteractive, onLeaveSelectMode]);

  const toggleCommentMode = useCallback(() => {
    const next = !isCommentMode;
    setIsCommentMode(next);
    if (next) {
      setIsInteractive(false);
      onEnterCommentMode();
      onLeaveSelectMode();
    }
  }, [isCommentMode, onEnterCommentMode, onLeaveSelectMode]);

  const exitCommentMode = useCallback(() => setIsCommentMode(false), []);

  useEffect(() => {
    if (!isReadOnlyViewer) return;
    setIsInteractive(true);
    setIsCommentMode(false);
    onLeaveSelectMode();
  }, [isReadOnlyViewer, onLeaveSelectMode]);

  return {
    isInteractive,
    isCommentMode,
    toggleInteractive,
    toggleCommentMode,
    exitCommentMode,
  };
}
