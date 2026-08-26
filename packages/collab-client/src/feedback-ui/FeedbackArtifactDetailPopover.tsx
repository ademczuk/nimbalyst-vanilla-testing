/**
 * Studying one option properly without leaving the comparison.
 *
 * The level that was missing. Before this, deciding between designs had two
 * stops and neither decided anything: a 128px card, which tells options apart
 * but cannot show a layout, and a full tab, which shows one design properly and
 * costs you the others. Opening a tab is what loses the comparison -- by the
 * time you are back, you are comparing against memory.
 *
 * So the popover is near-viewport, it is anchored to the card it grew from, and
 * two things live inside it that would otherwise be somewhere else:
 *
 * - **The vote is in the footer.** Same rule as the comparison itself: if
 *   deciding means dismissing first, the surface has split the decision from
 *   the thing it is about all over again.
 * - **Stepping carries your place.** Scroll to the pricing table in A, step to
 *   B, land on B's pricing table. As a fraction, never as pixels -- see
 *   `artifactScrollCarry`.
 *
 * ## The content is live, and that has a cost worth naming
 *
 * Clicks reach the mockup: hover states, disclosure toggles, tab strips inside
 * the design. That is most of what makes a design feel like a thing rather than
 * a picture of one.
 *
 * The cost is that a dead-end control now reads as a bug. Nothing was clickable
 * before and nobody expected anything; now an unbuilt button inside someone's
 * mockup looks broken and gets filed as one. The chrome answers that: it is
 * persistent, quiet, and says what this is -- a mockup, by name -- rather than
 * presenting an unlabelled interactive surface.
 *
 * Interactive is not editable, and the boundary is structural rather than
 * enforced: `MockupEditor` holds the HTML *source* in a `Y.Text` and renders it
 * into the iframe, so DOM mutation inside the frame has no path back to the
 * shared document. That safety is a property of how the editor is built today
 * and nobody wrote it down, so it is covered by a test rather than trusted.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FeedbackAskArtifact } from '@nimbalyst/collab-protocol';
import {
  FloatingFocusManager,
  FloatingOverlay,
  FloatingPortal,
  autoUpdate,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from '@floating-ui/react';

import { ArtifactViewport } from './ArtifactViewport';

/** Breathing room between the popover and the window edge. */
const VIEWPORT_PADDING = 24;

/**
 * Centred and near-viewport rather than anchored to the card.
 *
 * This started anchored, which is what the plan asked for, and the plan also
 * said to check that against `DIALOGS.md` if the sizing landed near-fullscreen.
 * It does, and anchoring was actively costing what the surface exists for:
 * anchored below a card halfway down the screen, floating-ui correctly offered
 * only the ~440px beneath it, so "study this design properly" got a third of
 * the window while two thirds sat empty above.
 *
 * A control that wants the whole screen is a dialog. The anchor is still passed
 * to `useFloating` -- dismissal, focus return and roles all key off it -- but it
 * no longer decides the geometry.
 *
 * Capped in width because the artifacts are authored around 1000px: past that
 * the extra pixels are margin, and a 2500px-wide reading column is worse than a
 * centred one.
 */
const DIALOG_STYLE: React.CSSProperties = {
  position: 'fixed',
  top: VIEWPORT_PADDING,
  bottom: VIEWPORT_PADDING,
  left: VIEWPORT_PADDING,
  right: VIEWPORT_PADDING,
  maxWidth: 1400,
  margin: '0 auto',
};

/**
 * Structurally identical to the extension SDK's `EditorViewport`, and declared
 * here rather than imported for the reason `structuredInput.ts` gives for
 * staying free of collaboration types: this package bundles for the browser,
 * and taking a dependency on the extension SDK to name a two-method interface
 * would pull the whole editor contract into a bundle that has no editors in it.
 *
 * The host passes the SDK's own type and it satisfies this one, so the two stay
 * compatible without either package importing the other.
 */
export interface FeedbackArtifactScrollViewport {
  /** Current position in `[0, 1]`. Content with nowhere to scroll returns 0. */
  getScrollFraction(): number;
  /** Restore a position captured from a document of any length. */
  setScrollFraction(fraction: number): void;
}

/**
 * One thing the popover can show. Built by the ask field rather than derived
 * here, so the popover never has to know what an ask type is.
 */
export interface FeedbackArtifactDetailEntry {
  /** A `singleSelect` option id or a `reorder` item id. */
  entryId: string;
  artifact: FeedbackAskArtifact;
  /** The entry's own label. This is what the vote is for, not the artifact's. */
  label: string;
}

/**
 * What the host is handed when the popover asks it to paint an artifact.
 *
 * `onViewportReady` is how the scroll carry crosses the layering boundary. The
 * popover cannot read a scroll position that lives inside an extension's
 * iframe, and has no business trying; the editor publishes one through
 * `EditorHost.registerViewport` and the host forwards it here. A host that does
 * not, or an editor that never registers, simply does not carry scroll -- each
 * artifact then opens at the top, which is a worse experience and not a bug.
 */
export interface FeedbackArtifactDetailMountApi {
  onViewportReady(viewport: FeedbackArtifactScrollViewport | null): void;
}

/**
 * Paints one artifact at full size. Returning nullish is a supported answer,
 * exactly as for the card preview renderer: "I can paint artifacts, and this
 * particular one has nothing to show."
 */
export type FeedbackArtifactDetailRenderer = (
  entry: FeedbackArtifactDetailEntry,
  api: FeedbackArtifactDetailMountApi,
) => React.ReactNode;

export interface FeedbackArtifactDetailPopoverProps {
  entries: readonly FeedbackArtifactDetailEntry[];
  activeEntryId: string;
  onActiveEntryChange(entryId: string): void;
  onDismiss(): void;
  /** The card or column this grew from. Anchoring keeps the origin legible. */
  anchor: HTMLElement | null;
  /** Nullish means the host cannot paint this artifact; the chrome says so. */
  renderArtifact: FeedbackArtifactDetailRenderer;
  /** Absent means this ask is not a vote (a reorder), so no footer control. */
  onSelect?(entryId: string): void;
  selectedId?: string;
  disabled?: boolean;
  /** Escalation. The tab is one step further in, for commenting and editing. */
  onOpenInTab?(artifact: FeedbackAskArtifact): void;
}

const StepIcon: React.FC<{ back?: boolean }> = ({ back = false }) => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path
      d={back ? 'M7.5 2 3.5 6l4 4' : 'M4.5 2l4 4-4 4'}
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const FeedbackArtifactDetailPopover: React.FC<FeedbackArtifactDetailPopoverProps> = ({
  entries,
  activeEntryId,
  onActiveEntryChange,
  onDismiss,
  anchor,
  renderArtifact,
  onSelect,
  selectedId,
  disabled = false,
  onOpenInTab,
}) => {
  const activeIndex = entries.findIndex((entry) => entry.entryId === activeEntryId);
  const entry = activeIndex >= 0 ? entries[activeIndex] : undefined;

  /**
   * The live editor's viewport, and the place we are carrying between them.
   *
   * Refs rather than state on purpose: neither is rendered, and re-rendering
   * the popover when an editor registers would remount the artifact we just
   * mounted.
   */
  const viewportRef = useRef<FeedbackArtifactScrollViewport | null>(null);
  const carriedFractionRef = useRef(0);
  const [mountToken, setMountToken] = useState(0);

  const handleViewportReady = useCallback((viewport: FeedbackArtifactScrollViewport | null) => {
    viewportRef.current = viewport;
    if (!viewport) return;
    // The editor has just registered, so its content is laid out and a scroll
    // position will stick. Applying earlier silently no-ops against a document
    // that has no scrollable height yet.
    const carried = carriedFractionRef.current;
    if (carried > 0) viewport.setScrollFraction(carried);
  }, [mountToken]);

  /*
   * Stable, and load-bearing.
   *
   * Built inline this was a fresh object on every render, so the mount's
   * "unregister on the way out" effect -- which depends on it -- re-ran
   * constantly and nulled the viewport moments after the editor published it.
   * Stepping then read `null`, found no scroll position, and every artifact
   * opened at the top: the carry looked unimplemented rather than broken.
   */
  const mountApi = useMemo(
    () => ({ onViewportReady: handleViewportReady }),
    [handleViewportReady],
  );

  const stepTo = useCallback((nextEntryId: string) => {
    if (nextEntryId === activeEntryId) return;
    carriedFractionRef.current = viewportRef.current?.getScrollFraction() ?? 0;
    viewportRef.current = null;
    setMountToken((token) => token + 1);
    onActiveEntryChange(nextEntryId);
  }, [activeEntryId, onActiveEntryChange]);

  const stepBy = useCallback((delta: number) => {
    if (activeIndex < 0) return;
    const next = entries[activeIndex + delta];
    if (next) stepTo(next.entryId);
  }, [activeIndex, entries, stepTo]);

  const { refs, context } = useFloating({
    open: true,
    onOpenChange: (open) => {
      if (!open) onDismiss();
    },
    elements: { reference: anchor ?? undefined },
    placement: 'bottom',
    /*
     * Fixed, not floating-ui's default `absolute`.
     *
     * This portals into a viewport-fixed `FloatingOverlay` while its anchor —
     * an option card — lives inside a scrolled transcript. Under `absolute`
     * the offsets are computed against the anchor's scroll container and
     * applied against the overlay, which put the popover 5,460px above the
     * viewport: chrome present and queryable in the DOM, nothing on screen,
     * and the preview slot correctly refusing to mount an editor that was not
     * visible. Only the coordinate space was wrong.
     */
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
  });

  const dismiss = useDismiss(context, { outsidePress: true, escapeKey: true });
  const role = useRole(context, { role: 'dialog' });
  const { getFloatingProps } = useInteractions([dismiss, role]);

  useEffect(() => () => {
    // The popover holds a priority preview slot through its mount; dropping the
    // viewport reference on the way out keeps a dead editor from being asked
    // for a scroll position by a later open.
    viewportRef.current = null;
  }, []);

  if (!entry) return null;

  const previous = entries[activeIndex - 1];
  const next = entries[activeIndex + 1];
  const selected = selectedId === entry.entryId;
  const painted = renderArtifact(entry, mountApi);

  return (
    <FloatingPortal>
      {/* The popover is near-viewport, so the page behind it is backdrop rather
          than context. Dimming says the comparison is paused, not gone. */}
      <FloatingOverlay className="feedback-artifact-detail-overlay z-[900] bg-black/50" lockScroll>
        <FloatingFocusManager context={context} modal returnFocus>
          <div
            ref={refs.setFloating}
            style={DIALOG_STYLE}
            data-testid="feedback-artifact-detail-popover"
            aria-label={`${entry.label} — ${entry.artifact.label}`}
            className="feedback-artifact-detail-popover flex flex-col overflow-hidden rounded-lg border border-nim bg-nim-secondary shadow-2xl"
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight') {
                event.preventDefault();
                stepBy(1);
              } else if (event.key === 'ArrowLeft') {
                event.preventDefault();
                stepBy(-1);
              }
            }}
            {...getFloatingProps()}
          >
            {/*
              Persistent and quiet, and load-bearing for a reason the visual
              weight does not suggest: the content below is live, so without a
              frame that names what this is, an unbuilt control inside someone's
              mockup reads as a broken part of Nimbalyst.
            */}
            <div className="feedback-artifact-detail-chrome flex shrink-0 items-center gap-2 border-b border-nim bg-nim px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-xs font-semibold text-nim select-text">
                {entry.label}
              </span>
              <span className="shrink-0 truncate text-[0.6875rem] text-nim-muted select-text">
                {entry.artifact.label}
              </span>
              {entry.artifact.context && (
                <span className="shrink-0 truncate text-[0.6875rem] text-nim-faint select-text">
                  {entry.artifact.context}
                </span>
              )}
              <button
                type="button"
                data-testid="feedback-artifact-detail-close"
                aria-label="Close"
                onClick={onDismiss}
                className="shrink-0 rounded border border-nim bg-nim-secondary px-2 py-0.5 text-[0.6875rem] text-nim-muted cursor-pointer hover:text-nim"
              >
                Close
              </button>
            </div>

            <div className="feedback-artifact-detail-body relative min-h-0 flex-1">
              {painted ? (
                <ArtifactViewport>{painted}</ArtifactViewport>
              ) : (
                <div
                  data-testid="feedback-artifact-detail-unavailable"
                  className="flex h-full w-full items-center justify-center px-6 text-center text-xs text-nim-muted"
                >
                  This artifact cannot be shown here.
                  {onOpenInTab && ' Open it to take a closer look.'}
                </div>
              )}
            </div>

            <div className="feedback-artifact-detail-footer flex shrink-0 items-center gap-2 border-t border-nim bg-nim px-3 py-2">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  data-testid="feedback-artifact-detail-previous"
                  aria-label="Previous option"
                  disabled={!previous}
                  onClick={() => stepBy(-1)}
                  className="flex h-6 w-6 items-center justify-center rounded border border-nim bg-nim-secondary text-nim-muted cursor-pointer hover:text-nim disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <StepIcon back />
                </button>
                <span className="px-1 text-[0.6875rem] tabular-nums text-nim-faint">
                  {activeIndex + 1} of {entries.length}
                </span>
                <button
                  type="button"
                  data-testid="feedback-artifact-detail-next"
                  aria-label="Next option"
                  disabled={!next}
                  onClick={() => stepBy(1)}
                  className="flex h-6 w-6 items-center justify-center rounded border border-nim bg-nim-secondary text-nim-muted cursor-pointer hover:text-nim disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <StepIcon />
                </button>
              </div>

              <span className="flex-1" />

              {onOpenInTab && (
                <button
                  type="button"
                  data-testid="feedback-artifact-detail-open-tab"
                  onClick={() => onOpenInTab(entry.artifact)}
                  className="rounded border border-nim bg-nim-secondary px-2.5 py-1 text-[0.6875rem] text-nim-muted cursor-pointer hover:text-nim"
                >
                  Open to comment
                </button>
              )}

              {onSelect && (
                <button
                  type="button"
                  data-testid="feedback-artifact-detail-select"
                  aria-pressed={selected}
                  disabled={disabled}
                  onClick={() => onSelect(entry.entryId)}
                  className={
                    selected
                      ? 'rounded border border-nim-primary bg-nim-primary px-3 py-1 text-[0.6875rem] font-semibold text-nim-on-primary cursor-pointer disabled:cursor-not-allowed disabled:opacity-50'
                      : 'rounded border border-nim-primary bg-nim-secondary px-3 py-1 text-[0.6875rem] font-semibold text-nim-primary cursor-pointer hover:bg-nim-hover disabled:cursor-not-allowed disabled:opacity-50'
                  }
                >
                  {selected ? 'Picked' : 'Pick this'}
                </button>
              )}
            </div>
          </div>
        </FloatingFocusManager>
      </FloatingOverlay>
    </FloatingPortal>
  );
};
