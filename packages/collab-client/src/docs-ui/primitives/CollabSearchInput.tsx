import React from 'react';

/**
 * The one text-filter control shared by every collab surface that narrows a
 * list: the shared-documents tree in `CollabSidebar` and the organization
 * member roster in the web console. It was inlined in the sidebar first; the
 * console's member search wanted the same affordance down to the clear button,
 * so it lives here rather than being typed a second time.
 *
 * Deliberately uncontrolled-of-nothing: the caller owns the term, because each
 * host filters a different collection and some of them debounce.
 */
export function CollabSearchInput({
  value,
  onChange,
  placeholder,
  label,
  className = '',
  autoFocus = false,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Placeholder text; also the accessible name when `label` is omitted. */
  placeholder: string;
  /** Accessible name, when it should read differently from the placeholder. */
  label?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  const accessibleName = label ?? placeholder;
  const hasValue = value.trim().length > 0;
  return (
    <div className={`collab-search-input relative ${className}`}>
      <input
        type="text"
        className="collab-search-input-field nim-input w-full pl-3 pr-9 py-2 text-[13px] text-[var(--nim-text)] bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] rounded outline-none transition-colors duration-150 placeholder:text-[var(--nim-text-faint)] focus:border-[var(--nim-primary)] focus:bg-[var(--nim-bg)]"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={accessibleName}
        autoFocus={autoFocus}
      />
      {hasValue && (
        <button
          type="button"
          className="collab-search-input-clear absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center w-5 h-5 rounded text-[var(--nim-text-muted)] bg-transparent border-none cursor-pointer transition-colors duration-150 hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-text)]"
          onClick={() => onChange('')}
          aria-label={`Clear ${accessibleName.toLowerCase()}`}
          title="Clear search"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  );
}
