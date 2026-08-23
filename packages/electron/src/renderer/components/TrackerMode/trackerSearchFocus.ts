/**
 * Cmd+F in Tracker Mode puts the cursor in the search box.
 *
 * The chord never reaches the renderer as a keystroke: Edit > Find owns the
 * accelerator, so it arrives as the `menu:find` IPC and `useIPCHandlers` routes
 * it by content mode (editor find in Files/Collab, transcript find in Agent).
 * Tracker Mode's branch dispatches this event, which is how the command reaches
 * whichever `TrackerFilterOmnibox` is mounted -- the toolbar one in the list
 * presentation, the list-pane one in document view. The two presentations are
 * mutually exclusive, so exactly one instance ever answers.
 */

export const TRACKER_FOCUS_SEARCH_EVENT = 'nimbalyst:tracker-focus-search';

export function dispatchTrackerFocusSearch(): void {
  window.dispatchEvent(new CustomEvent(TRACKER_FOCUS_SEARCH_EVENT));
}
