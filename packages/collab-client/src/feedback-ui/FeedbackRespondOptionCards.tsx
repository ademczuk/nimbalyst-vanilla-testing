/**
 * The pick-one question, rendered as preview cards.
 *
 * This is the one place the respond surface departs from the compose surface's
 * option rows, and the departure is structural rather than cosmetic. Compose
 * renders `WidgetOptionList` + `WidgetOptionRow`: a single column of horizontal
 * rows, indicator then label then description, sized to be skimmed. Here the
 * options are a grid of vertical cards -- a preview panel on top, the choice
 * beneath it -- and selection is carried by the card frame rather than by the
 * indicator alone.
 *
 * The reason is that "which of these three do you like" is a visual question. A
 * radio list answers it badly: it makes three designs look like three strings,
 * and it makes the option you can read fastest win.
 *
 * The preview panel is a seam, not a picture. The protocol's `singleSelect`
 * option carries id, label and description and nothing else, so there is no
 * artifact here to render honestly. A caller that has one -- a subject shared
 * alongside the request, a rendered thumbnail -- supplies `renderPreview`, and
 * without one the panel stays a neutral placeholder rather than inventing an
 * image the option never had.
 */

import React from 'react';
import type {
  FeedbackAskArtifact,
  StructuredInputSingleSelectOption,
} from '@nimbalyst/collab-protocol';
import type { FeedbackArtifactActionResolver } from './FeedbackArtifactSubjects';

/**
 * Returning nullish is a supported answer, not a failure: "I have a renderer,
 * and this particular artifact has nothing worth showing." The card then falls
 * through to the titled placeholder.
 */
export type FeedbackOptionPreviewRenderer = (
  option: StructuredInputSingleSelectOption,
  index: number,
  artifact?: FeedbackAskArtifact,
) => React.ReactNode;

export interface FeedbackRespondOptionCardsProps {
  askId: string;
  options: readonly StructuredInputSingleSelectOption[];
  /** Bound per-entry resources, keyed to option ids. */
  artifacts?: readonly FeedbackAskArtifact[];
  selectedId?: string;
  onSelect: (optionId: string) => void;
  disabled?: boolean;
  renderPreview?: FeedbackOptionPreviewRenderer;
  /**
   * Shown as an expand affordance on each preview when a caller can open one.
   * Only rendered for options that actually have an artifact to open -- an
   * expand button over a placeholder is a promise the card cannot keep.
   *
   * The card reports the element it grew from so the caller can anchor a
   * popover to it. Where the artifact ends up -- a popover in place, or a tab
   * -- is the caller's decision, not the card's.
   */
  onExpand?: (artifact: FeedbackAskArtifact, anchor: HTMLElement | null) => void;
  resolveAction?: FeedbackArtifactActionResolver;
}

const OptionRadio: React.FC<{ selected: boolean }> = ({ selected }) => (
  <span
    className={
      selected
        ? 'w-[15px] h-[15px] mt-0.5 shrink-0 rounded-full border border-nim-primary bg-nim-primary flex items-center justify-center'
        : 'w-[15px] h-[15px] mt-0.5 shrink-0 rounded-full border border-nim-faint bg-nim flex items-center justify-center'
    }
  >
    {selected && <span className="w-[5px] h-[5px] rounded-full bg-nim-on-primary" />}
  </span>
);

/**
 * The fallback, and it covers more than "no artifact". An artifact whose kind
 * has no registered editor, or one the host could not resolve, lands here too:
 * a titled card is honest about having nothing to show, where an empty scaled
 * frame looks like a preview that failed to load.
 */
export const FeedbackOptionPlaceholderPreview: React.FC<{
  label: string;
  artifactLabel?: string;
  /**
   * Why there is nothing to show, when the caller knows. "This artifact never
   * had a preview" and "this artifact has one and it could not be reached" look
   * identical without it, and only the second is a problem worth reporting.
   */
  note?: string;
}> = ({
  label,
  artifactLabel,
  note,
}) => (
  <div
    className="feedback-respond-option-placeholder flex h-full w-full flex-col items-center justify-center gap-1 rounded bg-nim-tertiary text-nim-faint"
  >
    <span aria-hidden="true" className="text-lg font-semibold">
      {label.trim().charAt(0).toUpperCase() || '?'}
    </span>
    {artifactLabel && (
      <span className="max-w-full truncate px-2 text-[0.6875rem] text-nim-muted">
        {artifactLabel}
      </span>
    )}
    {note && (
      <span className="feedback-respond-option-placeholder-note max-w-full px-3 text-center text-[0.6875rem] leading-snug text-nim-faint">
        {note}
      </span>
    )}
  </div>
);

export const FeedbackRespondOptionCards: React.FC<FeedbackRespondOptionCardsProps> = ({
  askId,
  options,
  artifacts,
  selectedId,
  onSelect,
  disabled = false,
  renderPreview,
  onExpand,
  resolveAction,
}) => (
  <div
    data-testid="feedback-respond-option-cards"
    className="feedback-respond-option-cards grid gap-2.5"
    /*
     * Sized to the options, not to a fixed three.
     *
     * A hard `grid-cols-3` gave two mockups a third of the width each and left
     * the last column empty -- measured, that put a 1000px design at 0.29 scale
     * with 10px-tall content. `auto-fit` spends the whole row on however many
     * options there are, and still wraps rather than crushing them when there
     * are five. The 260px floor is what keeps a wrapped row recognisable.
     */
    style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}
  >
    {options.map((option, index) => {
      const selected = option.id === selectedId;
      const artifact = artifacts?.find((entry) => entry.entryId === option.id);
      const preview = renderPreview?.(option, index, artifact);
      /*
       * A host that recognised the artifact's kind but could not resolve it
       * reports `unavailableReason` and no `open`. There is nothing behind the
       * button in that case, so there is no button -- the same rule the
       * placeholder follows one line up.
       */
      const resolved = artifact ? resolveAction?.(artifact) : undefined;
      const canExpand = Boolean(
        artifact && onExpand && (resolveAction === undefined || resolved?.open),
      );
      return (
        <div
          key={option.id}
          data-testid="feedback-respond-option-card"
          data-ask-id={askId}
          data-option-id={option.id}
          data-selected={selected || undefined}
          className={
            selected
              ? 'feedback-respond-option-card relative overflow-hidden rounded-md border border-nim-primary bg-[color-mix(in_srgb,var(--nim-primary)_8%,var(--nim-bg-secondary))] shadow-[0_0_0_1px_var(--nim-primary)]'
              : 'feedback-respond-option-card relative overflow-hidden rounded-md border border-nim bg-nim-secondary'
          }
        >
          {/*
            The whole panel is the target, not a corner icon. `ScaledPreviewFrame`
            already makes the scaled document `pointer-events: none`, so nothing
            inside the mockup can take the click -- which is exactly what makes
            the panel safe to click, and what made a 20px button beside it an
            arbitrarily small version of the same thing.

            The split is legible without being labelled: the picture is for
            looking, the row beneath it is for choosing.
          */}
          {canExpand && artifact ? (
            <button
              type="button"
              data-testid="feedback-respond-option-expand"
              aria-label={`Open ${artifact.label}`}
              onClick={(event) =>
                onExpand?.(
                  artifact,
                  event.currentTarget.closest<HTMLElement>('.feedback-respond-option-card'),
                )}
              className="feedback-respond-option-preview relative block h-44 w-full border-b border-nim bg-nim p-2.5 text-left cursor-zoom-in hover:ring-1 hover:ring-inset hover:ring-nim-primary"
            >
              {preview ?? (
                <FeedbackOptionPlaceholderPreview
                  label={option.label}
                  artifactLabel={artifact.label}
                />
              )}
            </button>
          ) : (
            <div className="feedback-respond-option-preview relative h-44 border-b border-nim bg-nim p-2.5">
              {preview ?? (
                <FeedbackOptionPlaceholderPreview
                  label={option.label}
                  artifactLabel={artifact?.label}
                />
              )}
            </div>
          )}
          <button
            type="button"
            data-testid="feedback-respond-option-choose"
            onClick={() => onSelect(option.id)}
            disabled={disabled}
            aria-pressed={selected}
            className="flex w-full items-start gap-2 bg-transparent border-none px-2.5 py-2.5 text-left cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 hover:bg-nim-hover"
          >
            <OptionRadio selected={selected} />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-xs font-semibold leading-snug text-nim select-text">
                {option.label}
              </span>
              {option.description && (
                <span className="text-[0.6875rem] leading-snug text-nim-muted select-text">
                  {option.description}
                </span>
              )}
            </span>
          </button>
        </div>
      );
    })}
  </div>
);
