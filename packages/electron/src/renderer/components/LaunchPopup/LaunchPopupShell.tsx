import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FloatingPortal,
  autoUpdate,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
  type VirtualElement,
} from '@floating-ui/react';
import { windowControlsClearance } from '@nimbalyst/runtime/ui/floating/windowControlsClearance';

/**
 * The bottom-anchored, draggable launcher chrome shared by the global popups
 * (session launch, tracker quick create).
 *
 * Scope is deliberately narrow: floating-ui placement against a virtual
 * bottom-center reference, the dim backdrop, title-bar dragging, and focus
 * stash/restore. It is not a general modal abstraction — these popups
 * intentionally sit outside DialogProvider so they can coexist with whatever
 * is already on screen.
 */

interface DragStart {
  pointerId: number;
  clientX: number;
  clientY: number;
  offsetX: number;
  offsetY: number;
}

export interface LaunchPopupShellProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Title-bar content. Also the drag handle's visible label. */
  title: React.ReactNode;
  /** Accessible name of the dialog element. */
  ariaLabel: string;
  /** Accessible name of the title-bar close button. */
  closeLabel: string;
  /** kebab-case DOM marker root; yields `${classPrefix}`, `-backdrop`, `-titlebar`. */
  classPrefix: string;
  /** CSS width for the floating panel. */
  width?: string;
  /** Changing this resets the drag offset (e.g. the active workspace path). */
  resetKey?: string | null;
  /** Invoked in a frame after the popup opens, for the owner to focus its input. */
  onOpened?: () => void;
  children: React.ReactNode;
}

export const LaunchPopupShell: React.FC<LaunchPopupShellProps> = ({
  open,
  onOpenChange,
  title,
  ariaLabel,
  closeLabel,
  classPrefix,
  width = 'min(720px, calc(100vw - 32px))',
  resetKey,
  onOpened,
  children,
}) => {
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<DragStart | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onOpenedRef = useRef(onOpened);
  onOpenedRef.current = onOpened;

  const virtualReference = useMemo<VirtualElement>(() => ({
    getBoundingClientRect: () => DOMRect.fromRect({
      x: window.innerWidth / 2 + dragOffset.x,
      y: window.innerHeight - 28 + dragOffset.y,
      width: 0,
      height: 0,
    }),
  }), [dragOffset]);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange,
    placement: 'top',
    strategy: 'fixed',
    middleware: [offset(16), shift({ padding: 16 }), windowControlsClearance()],
    whileElementsMounted: autoUpdate,
  });
  const dismiss = useDismiss(context, { outsidePress: false });
  const role = useRole(context, { role: 'dialog' });
  const { getFloatingProps } = useInteractions([dismiss, role]);

  useEffect(() => {
    refs.setPositionReference(virtualReference);
    return () => refs.setPositionReference(null);
  }, [refs, virtualReference]);

  useEffect(() => {
    let frame: number | undefined;
    if (open) {
      previousFocusRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      frame = requestAnimationFrame(() => onOpenedRef.current?.());
    } else {
      const previous = previousFocusRef.current;
      previousFocusRef.current = null;
      if (previous?.isConnected) frame = requestAnimationFrame(() => previous.focus());
    }
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [open]);

  useEffect(() => {
    setDragOffset({ x: 0, y: 0 });
    setIsDragging(false);
    dragStartRef.current = null;
  }, [resetKey]);

  const handleTitlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    dragStartRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      offsetX: dragOffset.x,
      offsetY: dragOffset.y,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setIsDragging(true);
    event.preventDefault();
  }, [dragOffset]);

  const handleTitlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    setDragOffset({
      x: start.offsetX + event.clientX - start.clientX,
      y: start.offsetY + event.clientY - start.clientY,
    });
  }, []);

  const finishTitleDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartRef.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragStartRef.current = null;
    setIsDragging(false);
  }, []);

  if (!open) return null;

  return (
    <FloatingPortal>
      <div
        className={`${classPrefix}-backdrop fixed inset-0 z-[900] bg-[var(--nim-bg)] opacity-20`}
        aria-hidden="true"
        onClick={() => onOpenChange(false)}
      />
      <div
        ref={refs.setFloating}
        style={{ ...floatingStyles, width }}
        className={`${classPrefix} z-[901] overflow-hidden rounded-lg border border-[var(--nim-border)] bg-[var(--nim-bg)] shadow-2xl`}
        aria-label={ariaLabel}
        data-drag-offset-x={dragOffset.x}
        data-drag-offset-y={dragOffset.y}
        {...getFloatingProps()}
      >
        <div
          className={`${classPrefix}-titlebar flex h-9 items-center justify-between border-b border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] px-3 text-xs font-medium text-[var(--nim-text)] ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
          style={{ touchAction: 'none', userSelect: 'none' }}
          onPointerDown={handleTitlePointerDown}
          onPointerMove={handleTitlePointerMove}
          onPointerUp={finishTitleDrag}
          onPointerCancel={finishTitleDrag}
        >
          <div className="min-w-0 flex-1">{title}</div>
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--nim-text-muted)] transition-colors hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-text)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--nim-border-focus)]"
            aria-label={closeLabel}
            onClick={() => onOpenChange(false)}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </FloatingPortal>
  );
};

/**
 * Toggle `open` every time the request counter atom changes. Re-pressing the
 * accelerator closes the popup, matching both launcher surfaces.
 */
export function useLaunchPopupToggle(
  requestVersion: number,
  options: { enabled: boolean; onBeforeOpen?: () => void },
): [boolean, React.Dispatch<React.SetStateAction<boolean>>] {
  const { enabled, onBeforeOpen } = options;
  const [open, setOpen] = useState(false);
  const seenVersionRef = useRef(requestVersion);
  const onBeforeOpenRef = useRef(onBeforeOpen);
  onBeforeOpenRef.current = onBeforeOpen;

  useEffect(() => {
    if (requestVersion === seenVersionRef.current) return;
    seenVersionRef.current = requestVersion;
    if (!enabled) return;
    setOpen((wasOpen) => {
      if (!wasOpen) onBeforeOpenRef.current?.();
      return !wasOpen;
    });
  }, [requestVersion, enabled]);

  return [open, setOpen];
}

export default LaunchPopupShell;
