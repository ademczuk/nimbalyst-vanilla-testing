/**
 * An icon button that copies one string and says so.
 *
 * The confirmation is the point. A clipboard write is invisible -- nothing on
 * screen changes and nothing is thrown when it fails -- so a bare button leaves
 * the reader to paste somewhere and find out. Desktop answers with a toast it
 * has a notification service for; a browser tab has none, so the button carries
 * its own transient state and announces it through `aria-live`.
 *
 * Routed through the runtime's `copyToClipboard` rather than
 * `navigator.clipboard` so the desktop host gets Electron's native clipboard,
 * where the web API can resolve without writing anything.
 */
import React from 'react';
export interface CopyLinkButtonProps {
    /** What lands on the clipboard. */
    value: string;
    /** The button's accessible name in its resting state. */
    label?: string;
    icon?: string;
    className?: string;
    testId?: string;
}
export declare function CopyLinkButton({ value, label, icon, className, testId, }: CopyLinkButtonProps): React.JSX.Element;
