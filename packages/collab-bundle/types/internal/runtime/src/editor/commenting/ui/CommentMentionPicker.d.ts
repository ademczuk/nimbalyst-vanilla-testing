/**
 * `@`-mention typeahead list for the comment composer.
 *
 * Purely presentational: the composer owns the query, the filtered candidate
 * list, and the active index, because it also owns the keyboard handling on
 * the text field. This component owns only positioning and the listbox
 * semantics, so it can hang off a textarea, a contenteditable, or any other
 * anchor an editor gives it.
 *
 * Positioned with `@floating-ui/react` through a `FloatingPortal` — never hand
 * -calculated `position: fixed`, which breaks at viewport edges and inside
 * transformed containers such as a zoomed mockup canvas.
 */
import type { JSX } from 'react';
import type { CommentMember } from '../types';
/** Stable id for the option at `index`, for `aria-activedescendant`. */
export declare function mentionOptionId(listboxId: string, index: number): string;
export interface CommentMentionPickerProps {
    /** The field the list positions against. */
    referenceElement: HTMLElement | null;
    /** Already filtered and truncated by the caller. */
    candidates: CommentMember[];
    activeIndex: number;
    open: boolean;
    /** Matches the field's `aria-controls`. */
    listboxId: string;
    onSelect(member: CommentMember): void;
    onActiveIndexChange(index: number): void;
    onDismiss(): void;
}
export declare function CommentMentionPicker({ referenceElement, candidates, activeIndex, open, listboxId, onSelect, onActiveIndexChange, onDismiss, }: CommentMentionPickerProps): JSX.Element | null;
