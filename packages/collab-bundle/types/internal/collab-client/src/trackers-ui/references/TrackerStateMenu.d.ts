/**
 * The state word as a control: click "Proposed" to get the valid next states,
 * what each means, and a footer saying everyone sees the change. Used by the
 * embedded card and by a host's own state line for the page item.
 *
 * It must not take the editor's caret. The trigger and rows cancel mousedown so
 * focus and selection stay in the document; the menu renders in a portal, so
 * its keystrokes never reach the editor; and when a prompt field did take
 * focus, closing hands it back with the editor's previous selection.
 */
import type { JSX } from 'react';
import type { TrackerItem } from '../../trackers/dataSource';
import { type StateTransition } from './trackerReferenceLifecycle';
import type { TrackerReferenceResolver } from './trackerReferenceResolver';
import './trackerReferenceViews.css';
/**
 * Returns focus to the enclosing editor with its previous selection. Provided
 * by the embedded views, which already load the editor; a context rather than
 * a direct import keeps Lexical out of the tracker surfaces that reuse this
 * menu. Absent means focus goes back to whatever held it before.
 */
export declare const TrackerStateMenuFocusContext: import("react").Context<(() => void) | null>;
/** A committed change, with what it overwrote so the caller can offer Undo. */
export interface TrackerStateChange {
    itemId: string;
    verb: string;
    updates: Record<string, unknown>;
    previous: Record<string, unknown>;
}
/** Called with the updates just before they are written, so a caller can tell its own echo apart. */
export type TrackerPendingWrite = (updates: Record<string, unknown>) => void;
/**
 * The current values of the fields `updates` would overwrite. A field the item
 * does not have is recorded as `undefined`, not `null`: writing it back leaves
 * the key out of the JSON-encoded payload, so Undo restores absence exactly.
 */
export declare function previousValues(resolver: TrackerReferenceResolver, item: TrackerItem, updates: Record<string, unknown>): Record<string, unknown>;
/** Write a set of updates and report the change. Throws when the write fails. */
export declare function commitTrackerUpdates(resolver: TrackerReferenceResolver, item: TrackerItem, updates: Record<string, unknown>, verb: string, onPending?: TrackerPendingWrite): Promise<TrackerStateChange>;
/** Run a menu transition (also what Apply on an agent proposal runs). */
export declare function runStateTransition(resolver: TrackerReferenceResolver, item: TrackerItem, transition: StateTransition, options?: {
    input?: string;
    extra?: Record<string, unknown>;
    onPending?: TrackerPendingWrite;
}): Promise<TrackerStateChange>;
/** The menu rows for an item, from its type's statuses and current fields. */
export declare function useStateTransitions(resolver: TrackerReferenceResolver, item: TrackerItem): StateTransition[];
/** Opens the menu on one transition's prompt, prefilled (Apply on an agent proposal). */
export interface TrackerStateMenuRequest {
    transitionId: string;
    input: string;
    /** Written alongside the transition's own updates, e.g. clearing the proposal. */
    extra?: Record<string, unknown>;
}
export interface TrackerStateMenuProps {
    resolver: TrackerReferenceResolver;
    item: TrackerItem;
    /** Called after a change commits, e.g. to show "You accepted just now · Undo". */
    onChanged?: (change: TrackerStateChange) => void;
    onPending?: TrackerPendingWrite;
    request?: TrackerStateMenuRequest | null;
    onRequestHandled?: () => void;
    /** Forces the plain word even when the resolver can write. */
    readOnly?: boolean;
    className?: string;
}
/**
 * The state word. A button with a chevron when the resolver can write the
 * item; plain colored text when it cannot.
 */
export declare function TrackerStateMenu({ resolver, item, onChanged, onPending, request, onRequestHandled, readOnly, className, }: TrackerStateMenuProps): JSX.Element | null;
