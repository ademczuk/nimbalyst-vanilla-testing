import {
  ORG_WINDOW_COMMANDS,
  isOrgWindowCommand,
  type OrgWindowCommand,
} from '../../../shared/orgWindowCommands';

/**
 * The org window's messaging command bus.
 *
 * `TeamManagementApp` is the only publisher — it turns the native Messages menu
 * (over IPC) and the window's own key handling into one command stream. The
 * consumers sit deep in the tree (`TeamMode`'s body owns routing and the
 * compose dialog; the Inbox owns its search field), and a window `CustomEvent`
 * keeps them decoupled from it: nothing has to be threaded through props, and
 * the sibling components stay editable without touching this wiring.
 *
 * The same imperative-event shape as `nimbalyst:workstream-open-tracker`.
 */
export const ORG_WINDOW_COMMAND_EVENT = 'nimbalyst:org-window-command';

export { ORG_WINDOW_COMMANDS, isOrgWindowCommand };
export type { OrgWindowCommand };

interface OrgWindowCommandEventDetail {
  surfaceId: string;
  command: OrgWindowCommand;
}

export function dispatchOrgWindowCommand(
  surfaceId: string,
  command: OrgWindowCommand,
): void {
  window.dispatchEvent(
    new CustomEvent<OrgWindowCommandEventDetail>(ORG_WINDOW_COMMAND_EVENT, {
      detail: { surfaceId, command },
    }),
  );
}

/**
 * Subscribe to one command. Returns the unsubscribe closure, matching the
 * shape `window.electronAPI.on` returns.
 */
export function subscribeOrgWindowCommand(
  surfaceId: string,
  command: OrgWindowCommand,
  handler: () => void,
): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<OrgWindowCommandEventDetail>).detail;
    if (detail.surfaceId !== surfaceId || detail.command !== command) return;
    handler();
  };
  window.addEventListener(ORG_WINDOW_COMMAND_EVENT, listener);
  return () => window.removeEventListener(ORG_WINDOW_COMMAND_EVENT, listener);
}

/**
 * A pending "put the cursor in the Inbox search field" request.
 *
 * Search Messages routes the window to the Inbox first, so the field it wants
 * to focus usually does not exist yet when the command fires. The request is
 * therefore latched: a mounted field consumes it immediately, and one that
 * mounts a tick later picks it up on its way in.
 */
const inboxSearchFocusPending = new Set<string>();
const inboxSearchFocusListeners = new Map<string, Set<() => void>>();

export function requestInboxSearchFocus(surfaceId: string): void {
  inboxSearchFocusPending.add(surfaceId);
  for (const listener of inboxSearchFocusListeners.get(surfaceId) ?? []) listener();
}

/** True at most once per request; the caller is expected to focus the field. */
export function consumeInboxSearchFocusRequest(surfaceId: string): boolean {
  const pending = inboxSearchFocusPending.has(surfaceId);
  inboxSearchFocusPending.delete(surfaceId);
  return pending;
}

export function subscribeInboxSearchFocus(
  surfaceId: string,
  listener: () => void,
): () => void {
  const listeners = inboxSearchFocusListeners.get(surfaceId) ?? new Set();
  listeners.add(listener);
  inboxSearchFocusListeners.set(surfaceId, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) inboxSearchFocusListeners.delete(surfaceId);
  };
}

/**
 * A pending "select the Inbox row for this source" request.
 *
 * A `nimbalyst://feedback-request/...` link opens or focuses the organization
 * window and points it at the Inbox, so the row it wants is behind two waits:
 * the surface mounting, and the delivery arriving in the snapshot. The request
 * is therefore latched by *source* rather than by delivery id — the link
 * carries a request id, and only the inbox knows which delivery carries it.
 *
 * Same latch as the search-focus request above; the Inbox clears it once it has
 * a row to select.
 */
export interface InboxRowSelectionRequest {
  orgId: string;
  sourceKind: string;
  sourceId: string;
}

const inboxRowSelectionPending = new Map<string, InboxRowSelectionRequest>();
const inboxRowSelectionListeners = new Map<string, Set<() => void>>();

export function requestInboxRowSelection(
  surfaceId: string,
  request: InboxRowSelectionRequest,
): void {
  inboxRowSelectionPending.set(surfaceId, request);
  for (const listener of inboxRowSelectionListeners.get(surfaceId) ?? []) listener();
}

/** Non-null at most once per request; the caller owns resolving it to a row. */
export function consumeInboxRowSelectionRequest(
  surfaceId: string,
): InboxRowSelectionRequest | null {
  const pending = inboxRowSelectionPending.get(surfaceId) ?? null;
  inboxRowSelectionPending.delete(surfaceId);
  return pending;
}

export function subscribeInboxRowSelection(
  surfaceId: string,
  listener: () => void,
): () => void {
  const listeners = inboxRowSelectionListeners.get(surfaceId) ?? new Set();
  listeners.add(listener);
  inboxRowSelectionListeners.set(surfaceId, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) inboxRowSelectionListeners.delete(surfaceId);
  };
}
