/**
 * Editor-neutral comment composer.
 *
 * A plain textarea rather than a nested editor instance: a comment body is
 * plain text in the canonical model, so the previous nested Lexical
 * plain-text editor bought nothing an editor-neutral field cannot do, and it
 * could not be mounted by an extension editor that has no Lexical in its
 * bundle. Cmd/Ctrl+Enter submits, Enter inserts a newline, Escape closes the
 * mention picker if one is open and otherwise cancels — the same contract the
 * Lexical composer had.
 *
 * Mentions are recorded as the user picks them and re-derived from the final
 * text on submit, so deleting `@Name` from the draft also drops the
 * notification. They are then intersected with the live roster: a member who
 * left the org mid-draft is silently dropped rather than failing the whole
 * comment with `MENTION_FORBIDDEN`.
 */
import type { JSX } from 'react';
import type { CommentMember } from '../types';
/**
 * The `@`-token immediately before the caret, or null.
 *
 * Mirrors the Lexical typeahead trigger this replaced: the trigger only fires
 * at the start of the field or after whitespace / an open paren, and the query
 * runs to the next whitespace, so a display name with a space in it is reached
 * by its first word.
 */
export declare function readMentionQuery(value: string, caret: number): {
    query: string;
    start: number;
} | null;
export interface CommentComposerProps {
    /** Live roster read; re-read while a mention query is open. */
    getMembers: () => CommentMember[];
    onSubmit(text: string, mentionedUserIds: string[]): void;
    /** Raised on Cancel and on Escape with no mention picker open. */
    onCancel(): void;
    submitLabel: string;
    placeholder: string;
    autoFocus?: boolean;
    /** Screen-reader name for the field; the placeholder is not one. */
    label?: string;
    className?: string;
}
export declare function CommentComposer({ getMembers, onSubmit, onCancel, submitLabel, placeholder, autoFocus, label, className, }: CommentComposerProps): JSX.Element;
