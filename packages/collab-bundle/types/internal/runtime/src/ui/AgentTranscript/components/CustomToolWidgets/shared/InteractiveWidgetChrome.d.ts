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
export interface InteractiveWidgetCardProps {
    /** Semantic kebab-case DOM marker for this widget's root. */
    rootClassName?: string;
    testId?: string;
    /** Value for `data-state` (e.g. `pending`, `completed`, `draft`). */
    state?: string;
    tone: InteractiveWidgetTone;
    children: React.ReactNode;
}
export declare const InteractiveWidgetCard: React.FC<InteractiveWidgetCardProps>;
export interface InteractiveWidgetHeaderProps {
    /** Rendered inside the fixed 20x20 primary-tinted icon slot. */
    icon: React.ReactNode;
    title: React.ReactNode;
    /** Status pill or other trailing affordance. */
    trailing?: React.ReactNode;
}
export declare const InteractiveWidgetHeader: React.FC<InteractiveWidgetHeaderProps>;
export interface WidgetStatusPillProps {
    tone: WidgetStatusPillTone;
    testId?: string;
    children: React.ReactNode;
}
export declare const WidgetStatusPill: React.FC<WidgetStatusPillProps>;
export declare const InteractiveWidgetBody: React.FC<{
    children: React.ReactNode;
}>;
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
export declare const WidgetBlock: React.FC<WidgetBlockProps>;
export declare const WidgetOptionList: React.FC<{
    children: React.ReactNode;
}>;
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
export declare const WidgetOptionRow: React.FC<WidgetOptionRowProps>;
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
export declare const WidgetNoteRow: React.FC<WidgetNoteRowProps>;
export interface WidgetFooterProps {
    /** Left-aligned muted note explaining what the primary action will do. */
    note?: React.ReactNode;
    children: React.ReactNode;
}
export declare const WidgetFooter: React.FC<WidgetFooterProps>;
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
export declare const WidgetQuietLink: React.FC<WidgetQuietLinkProps>;
export interface WidgetActionButtonProps {
    variant: 'primary' | 'secondary';
    onClick: () => void;
    disabled?: boolean;
    testId?: string;
    children: React.ReactNode;
}
export declare const WidgetActionButton: React.FC<WidgetActionButtonProps>;
