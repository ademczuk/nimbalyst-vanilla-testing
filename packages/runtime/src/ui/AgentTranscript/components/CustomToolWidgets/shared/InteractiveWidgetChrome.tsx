/**
 * Shared chrome for interactive transcript widgets.
 *
 * The card, header bar, status pill, question block, option row, and
 * Cancel/primary footer were written inline in AskUserQuestionWidget and are
 * the visual vocabulary every feedback surface reuses. They are extracted here
 * so the compose surface (and later the respond and results surfaces) render
 * the same card instead of three near-copies of it.
 *
 * These are presentation-only: no atoms, no host, no transport. That is
 * deliberate -- the local AskUserQuestion path must stay structurally
 * incapable of acquiring a network or collaboration dependency through its
 * chrome.
 *
 * The class strings below are byte-identical to the ones AskUserQuestionWidget
 * emitted before the extraction; `rootClassName` is optional so that widget can
 * keep its exact markup while new consumers attach their own DOM marker.
 */

import React from 'react';

/** `active` is an open/pending widget; `resolved` is a completed or cancelled one. */
export type InteractiveWidgetTone = 'active' | 'resolved';

export type WidgetStatusPillTone = 'success' | 'muted' | 'primary' | 'warning';

function joinClasses(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

// ============================================================
// Card shell
// ============================================================

export interface InteractiveWidgetCardProps {
  /** Semantic kebab-case DOM marker for this widget's root. */
  rootClassName?: string;
  testId?: string;
  /** Value for `data-state` (e.g. `pending`, `completed`, `draft`). */
  state?: string;
  tone: InteractiveWidgetTone;
  children: React.ReactNode;
}

export const InteractiveWidgetCard: React.FC<InteractiveWidgetCardProps> = ({
  rootClassName,
  testId,
  state,
  tone,
  children,
}) => (
  <div
    data-testid={testId}
    data-state={state}
    className={joinClasses(
      rootClassName,
      'rounded-lg bg-nim-secondary border',
      tone === 'active' ? 'border-nim-primary' : 'border-nim',
      'overflow-hidden',
      tone === 'resolved' && 'opacity-85',
    )}
  >
    {children}
  </div>
);

// ============================================================
// Header bar
// ============================================================

export interface InteractiveWidgetHeaderProps {
  /** Rendered inside the fixed 20x20 primary-tinted icon slot. */
  icon: React.ReactNode;
  title: React.ReactNode;
  /** Status pill or other trailing affordance. */
  trailing?: React.ReactNode;
}

export const InteractiveWidgetHeader: React.FC<InteractiveWidgetHeaderProps> = ({
  icon,
  title,
  trailing,
}) => (
  <div className="flex items-center gap-2 py-3 px-4 border-b border-nim bg-nim-tertiary">
    <div className="w-5 h-5 text-nim-primary shrink-0">{icon}</div>
    <span className="text-sm font-semibold text-nim flex-1">{title}</span>
    {trailing}
  </div>
);

const PILL_TONE_CLASSES: Record<WidgetStatusPillTone, string> = {
  success:
    'text-nim-success py-1 px-2 bg-[color-mix(in_srgb,var(--nim-success)_12%,transparent)]',
  muted: 'text-nim-muted py-1 px-2 bg-nim-tertiary',
  primary:
    'text-nim-primary py-1 px-2 bg-[color-mix(in_srgb,var(--nim-primary)_12%,transparent)]',
  warning:
    'text-nim-warning py-1 px-2 bg-[color-mix(in_srgb,var(--nim-warning)_12%,transparent)]',
};

export interface WidgetStatusPillProps {
  tone: WidgetStatusPillTone;
  testId?: string;
  children: React.ReactNode;
}

export const WidgetStatusPill: React.FC<WidgetStatusPillProps> = ({
  tone,
  testId,
  children,
}) => (
  <span
    data-testid={testId}
    className={`flex items-center gap-1 text-xs font-medium ${PILL_TONE_CLASSES[tone]} rounded-full`}
  >
    {children}
  </span>
);

// ============================================================
// Body + question block
// ============================================================

export const InteractiveWidgetBody: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => <div className="p-3 flex flex-col gap-3">{children}</div>;

export interface WidgetBlockProps {
  /** Uppercase tag shown in primary, e.g. `Subject`, `Q1 · Direction`. */
  tag: React.ReactNode;
  /** Muted italic aside next to the tag. */
  hint?: React.ReactNode;
  /** Neutral tag styling for non-question blocks (Delivery, Recipients). */
  tagTone?: 'primary' | 'neutral';
  /** The prose question, when the block carries one. */
  question?: React.ReactNode;
  /** Opt the question prose into text selection (content areas should). */
  selectableQuestion?: boolean;
  /** Semantic kebab-case DOM marker for this block. */
  rootClassName?: string;
  testId?: string;
  children?: React.ReactNode;
}

export const WidgetBlock: React.FC<WidgetBlockProps> = ({
  tag,
  hint,
  tagTone = 'primary',
  question,
  selectableQuestion,
  rootClassName,
  testId,
  children,
}) => (
  <div
    data-testid={testId}
    className={joinClasses(rootClassName, 'bg-nim border border-nim rounded-md p-3')}
  >
    <div className="flex items-center gap-2 mb-2">
      <span
        className={
          tagTone === 'primary'
            ? 'text-[0.6875rem] font-semibold uppercase tracking-wide text-nim-primary bg-[color-mix(in_srgb,var(--nim-primary)_12%,transparent)] py-0.5 px-2 rounded-full'
            : 'text-[0.6875rem] font-semibold uppercase tracking-wide text-nim-muted bg-nim-tertiary py-0.5 px-2 rounded-full'
        }
      >
        {tag}
      </span>
      {hint && <span className="text-[0.6875rem] text-nim-faint italic">{hint}</span>}
    </div>
    {question !== undefined && (
      <div
        className={joinClasses(
          'text-sm text-nim leading-normal mb-3',
          selectableQuestion && 'select-text',
        )}
      >
        {question}
      </div>
    )}
    {children}
  </div>
);

export const WidgetOptionList: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => <div className="flex flex-col gap-1.5">{children}</div>;

// ============================================================
// Option row
// ============================================================

const OPTION_INDICATOR_BASE =
  'w-4 h-4 mt-0.5 shrink-0 border rounded-sm flex items-center justify-center';

const OptionCheck: React.FC = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M8.5 2.5L3.75 7.25L1.5 5"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const OptionBody: React.FC<{ label: React.ReactNode; description?: React.ReactNode }> = ({
  label,
  description,
}) => (
  <div className="flex flex-col gap-0.5 flex-1 min-w-0">
    <span className="text-[0.8125rem] font-medium text-nim leading-snug">{label}</span>
    {description && (
      <span className="text-xs text-nim-muted leading-snug">{description}</span>
    )}
  </div>
);

export interface WidgetOptionRowProps {
  label: React.ReactNode;
  description?: React.ReactNode;
  selected: boolean;
  /** Omit to render a read-only row (a draft under review, or a settled answer). */
  onSelect?: () => void;
  disabled?: boolean;
  testId?: string;
  /** Extra `data-*` attributes for tests and devtools. */
  dataAttributes?: Record<string, string | boolean>;
}

export const WidgetOptionRow: React.FC<WidgetOptionRowProps> = ({
  label,
  description,
  selected,
  onSelect,
  disabled,
  testId,
  dataAttributes,
}) => {
  const indicator = (
    <div
      className={joinClasses(
        OPTION_INDICATOR_BASE,
        onSelect && 'transition-colors',
        selected
          ? 'bg-nim-primary border-nim-primary text-nim-on-primary'
          : 'bg-nim border-nim text-nim-primary',
      )}
    >
      {selected && <OptionCheck />}
    </div>
  );

  if (!onSelect) {
    return (
      <div
        data-testid={testId}
        {...dataAttributes}
        className={joinClasses(
          'flex items-start gap-2 py-2 px-2.5 rounded border cursor-default',
          selected
            ? 'border-nim-primary bg-[color-mix(in_srgb,var(--nim-primary)_8%,var(--nim-bg-secondary))]'
            : 'border-nim bg-nim-secondary',
        )}
      >
        {indicator}
        <OptionBody label={label} description={description} />
      </div>
    );
  }

  return (
    <button
      type="button"
      data-testid={testId}
      {...dataAttributes}
      onClick={onSelect}
      disabled={disabled}
      className={joinClasses(
        'flex items-start gap-2 py-2 px-2.5 rounded border transition-all duration-150 cursor-pointer text-left bg-transparent disabled:opacity-50 disabled:cursor-not-allowed',
        selected
          ? 'border-nim-primary bg-[color-mix(in_srgb,var(--nim-primary)_8%,var(--nim-bg-secondary))]'
          : 'border-nim bg-nim-secondary hover:bg-nim-hover',
      )}
    >
      {indicator}
      <OptionBody label={label} description={description} />
    </button>
  );
};

// ============================================================
// Note row
// ============================================================

export interface WidgetNoteRowProps {
  /** Small leading glyph, rendered in a fixed 14x14 faint slot. */
  icon?: React.ReactNode;
  /** Semantic kebab-case DOM marker for this row. */
  rootClassName?: string;
  testId?: string;
  children: React.ReactNode;
}

/**
 * A standing statement about the widget rather than an action on it -- what
 * stays hidden, what already happened, what the surface cannot do here. Set
 * apart from the question blocks so it never reads as one more thing to answer.
 */
export const WidgetNoteRow: React.FC<WidgetNoteRowProps> = ({
  icon,
  rootClassName,
  testId,
  children,
}) => (
  <div
    data-testid={testId}
    className={joinClasses(
      rootClassName,
      'flex items-center gap-2 rounded-md border border-nim bg-nim px-3 py-2 text-xs text-nim-muted',
    )}
  >
    {icon && <span className="w-3.5 h-3.5 shrink-0 text-nim-faint">{icon}</span>}
    <span className="select-text leading-snug">{children}</span>
  </div>
);

// ============================================================
// Footer
// ============================================================

export interface WidgetFooterProps {
  /** Left-aligned muted note explaining what the primary action will do. */
  note?: React.ReactNode;
  children: React.ReactNode;
}

export const WidgetFooter: React.FC<WidgetFooterProps> = ({ note, children }) => (
  <div
    className={joinClasses(
      'flex gap-2 justify-end',
      note ? 'items-center' : undefined,
      'pt-2 border-t border-nim',
    )}
  >
    {note && (
      <span className="mr-auto text-[0.6875rem] text-nim-faint leading-snug">{note}</span>
    )}
    {children}
  </div>
);

export interface WidgetQuietLinkProps {
  onClick: () => void;
  testId?: string;
  /** Semantic kebab-case DOM marker. */
  rootClassName?: string;
  children: React.ReactNode;
}

/**
 * A way out that is deliberately not a peer of the primary action.
 *
 * Text weight, no chrome, and it lives in the footer's note slot rather than
 * beside the buttons. An escape hatch drawn at the same weight as the primary
 * reads as a sanctioned alternative and people take it; drawn like this it is
 * still one click away for anyone who genuinely needs it.
 */
export const WidgetQuietLink: React.FC<WidgetQuietLinkProps> = ({
  onClick,
  testId,
  rootClassName,
  children,
}) => (
  <button
    type="button"
    data-testid={testId}
    onClick={onClick}
    className={joinClasses(
      rootClassName,
      'bg-transparent border-none p-0 text-[0.6875rem] text-nim-muted underline underline-offset-2 cursor-pointer hover:text-nim-primary',
    )}
  >
    {children}
  </button>
);

export interface WidgetActionButtonProps {
  variant: 'primary' | 'secondary';
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
  children: React.ReactNode;
}

export const WidgetActionButton: React.FC<WidgetActionButtonProps> = ({
  variant,
  onClick,
  disabled,
  testId,
  children,
}) => (
  <button
    type="button"
    data-testid={testId}
    onClick={onClick}
    disabled={disabled}
    className={
      variant === 'primary'
        ? 'px-4 py-1.5 rounded-md text-[13px] font-medium cursor-pointer border-none transition-colors duration-150 hover:opacity-90 bg-nim-primary text-nim-on-primary disabled:opacity-50 disabled:cursor-not-allowed'
        : 'px-3 py-1.5 rounded-md text-[13px] cursor-pointer border border-nim transition-colors duration-150 hover:bg-nim-hover bg-nim-tertiary text-nim-muted disabled:opacity-50 disabled:cursor-not-allowed'
    }
  >
    {children}
  </button>
);
