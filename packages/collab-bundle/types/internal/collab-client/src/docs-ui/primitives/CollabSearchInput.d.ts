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
export declare function CollabSearchInput({ value, onChange, placeholder, label, className, autoFocus, }: {
    value: string;
    onChange: (next: string) => void;
    /** Placeholder text; also the accessible name when `label` is omitted. */
    placeholder: string;
    /** Accessible name, when it should read differently from the placeholder. */
    label?: string;
    className?: string;
    autoFocus?: boolean;
}): React.JSX.Element;
