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

import type { JSX, KeyboardEvent } from 'react';
import { useCallback, useId, useMemo, useRef, useState } from 'react';

import type { CommentMember } from '../types';
import { validateCommentBody } from '../commentValidation';
import { CommentMentionPicker, mentionOptionId } from './CommentMentionPicker';
import {
  filterMentionCandidates,
  retainMentionableUserIds,
  useMentionRoster,
} from './mentionRoster';

const MAX_MENTION_CANDIDATES = 10;

/**
 * The `@`-token immediately before the caret, or null.
 *
 * Mirrors the Lexical typeahead trigger this replaced: the trigger only fires
 * at the start of the field or after whitespace / an open paren, and the query
 * runs to the next whitespace, so a display name with a space in it is reached
 * by its first word.
 */
export function readMentionQuery(
  value: string,
  caret: number,
): { query: string; start: number } | null {
  const upTo = value.slice(0, caret);
  const match = /(?:^|[\s(])@([^\s@]{0,75})$/.exec(upTo);
  if (!match) return null;
  return { query: match[1], start: caret - match[1].length - 1 };
}

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

export function CommentComposer({
  getMembers,
  onSubmit,
  onCancel,
  submitLabel,
  placeholder,
  autoFocus = false,
  label,
  className,
}: CommentComposerProps): JSX.Element {
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  // Held in state as well as a ref: the picker positions against the element,
  // and a ref alone would still read null on the render that opens it.
  const [fieldElement, setFieldElement] = useState<HTMLTextAreaElement | null>(
    null,
  );
  // displayName -> userId, for mentions the user actually picked.
  const mentionsRef = useRef<Map<string, string>>(new Map());
  const [value, setValue] = useState('');
  const [query, setQuery] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const listboxId = useId();

  const members = useMentionRoster(getMembers, query);
  const candidates = useMemo(
    () =>
      query === null
        ? []
        : filterMentionCandidates(members, query).slice(
            0,
            MAX_MENTION_CANDIDATES,
          ),
    [members, query],
  );
  const pickerOpen = query !== null && candidates.length > 0;
  const bodyIsValid = useMemo(() => {
    try {
      validateCommentBody(value);
      return true;
    } catch {
      return false;
    }
  }, [value]);

  // Mirrors `query` so `syncQuery` can tell a real change from a re-read.
  // Without it every keyup — including the arrow keys used to walk the picker
  // — would reset the highlight back to the first candidate.
  const queryRef = useRef<string | null>(null);

  const closePicker = useCallback(() => {
    queryRef.current = null;
    setQuery(null);
    setActiveIndex(0);
  }, []);

  const syncQuery = useCallback((field: HTMLTextAreaElement) => {
    const found = readMentionQuery(field.value, field.selectionStart ?? 0);
    const next = found ? found.query : null;
    if (queryRef.current === next) return;
    queryRef.current = next;
    setQuery(next);
    setActiveIndex(0);
  }, []);

  const insertMention = useCallback(
    (member: CommentMember) => {
      const field = fieldRef.current;
      if (!field) return;
      const caret = field.selectionStart ?? field.value.length;
      const found = readMentionQuery(field.value, caret);
      if (!found) return;
      const inserted = `@${member.name} `;
      const next =
        field.value.slice(0, found.start) + inserted + field.value.slice(caret);
      mentionsRef.current.set(member.name, member.userId);
      setValue(next);
      closePicker();
      // Restore the caret after React writes the new value, otherwise the
      // browser parks it at the end of the field for a mid-text mention.
      const caretAfter = found.start + inserted.length;
      requestAnimationFrame(() => {
        const current = fieldRef.current;
        if (!current) return;
        current.focus();
        current.setSelectionRange(caretAfter, caretAfter);
      });
    },
    [closePicker],
  );

  const submit = useCallback(() => {
    if (!value.trim()) {
      onCancel();
      return;
    }
    let text: string;
    try {
      text = validateCommentBody(value);
    } catch {
      return;
    }
    const mentioned: string[] = [];
    for (const [name, userId] of mentionsRef.current) {
      if (value.includes('@' + name)) mentioned.push(userId);
    }
    onSubmit(
      text,
      retainMentionableUserIds([...new Set(mentioned)], getMembers()),
    );
    setValue('');
    mentionsRef.current.clear();
    closePicker();
  }, [value, onSubmit, onCancel, getMembers, closePicker]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (pickerOpen) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setActiveIndex((index) => (index + 1) % candidates.length);
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          setActiveIndex(
            (index) => (index - 1 + candidates.length) % candidates.length,
          );
          return;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          event.preventDefault();
          insertMention(candidates[activeIndex]);
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          closePicker();
          return;
        }
      }
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        submit();
        return;
      }
      if (event.key === 'Escape') {
        // Owned here so it cancels the draft instead of closing the panel
        // out from under a half-written comment.
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }
    },
    [
      pickerOpen,
      candidates,
      activeIndex,
      insertMention,
      closePicker,
      submit,
      onCancel,
    ],
  );

  return (
    <div
      className={
        className ? `nim-comment-composer ${className}` : 'nim-comment-composer'
      }
      data-testid="comment-composer"
    >
      <textarea
        ref={(element) => {
          fieldRef.current = element;
          setFieldElement(element);
        }}
        className="nim-comment-composer-input"
        data-testid="comment-composer-input"
        // `aria-placeholder` alongside `placeholder` because the field has no
        // visible label; assistive tech reads the accessible name first.
        aria-label={label ?? placeholder}
        aria-placeholder={placeholder}
        placeholder={placeholder}
        aria-autocomplete="list"
        aria-expanded={pickerOpen}
        aria-controls={pickerOpen ? listboxId : undefined}
        aria-activedescendant={
          pickerOpen ? mentionOptionId(listboxId, activeIndex) : undefined
        }
        autoFocus={autoFocus}
        rows={2}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          syncQuery(event.target);
        }}
        onKeyUp={(event) => syncQuery(event.currentTarget)}
        onClick={(event) => syncQuery(event.currentTarget)}
        onBlur={closePicker}
        onKeyDown={handleKeyDown}
      />
      <CommentMentionPicker
        referenceElement={fieldElement}
        candidates={candidates}
        activeIndex={activeIndex}
        open={query !== null}
        listboxId={listboxId}
        onSelect={insertMention}
        onActiveIndexChange={setActiveIndex}
        onDismiss={closePicker}
      />
      <div className="nim-comment-composer-actions">
        <button
          type="button"
          className="nim-comment-btn nim-comment-btn-cancel"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="nim-comment-btn nim-comment-btn-submit"
          disabled={!bodyIsValid}
          onClick={submit}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
