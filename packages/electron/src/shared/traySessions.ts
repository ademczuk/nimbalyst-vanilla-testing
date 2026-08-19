/**
 * Wire contract between TrayManager (main) and the tray panel renderer.
 *
 * The panel is its own renderer with an empty Jotai store and is global by
 * definition, so it cannot read the workspace-scoped session atoms the in-app
 * popover uses. It is fed instead from `TrayManager.sessionCache`, which is
 * already the cross-workspace, debounced aggregate that drove the native menu.
 */

/** One session as the tray panel renders it. */
export interface TrayPanelSession {
  sessionId: string;
  title: string;
  workspacePath: string;
  /** Basename of `workspacePath`, shown as a chip because the panel spans workspaces. */
  workspaceName: string;
  provider: string;
  /** Provider-qualified model id, e.g. `claude-code:opus-1m`. Renderer strips the prefix. */
  model?: string;
  updatedAt: number;
  isStreaming: boolean;
  hasPendingPrompt: boolean;
  hasError: boolean;
}

/** The three attention buckets, mirroring `agentSessionAttentionAtom`. */
export interface TrayPanelFeed {
  needsAttention: TrayPanelSession[];
  running: TrayPanelSession[];
  unread: TrayPanelSession[];
}

export type TrayPanelSectionState = 'attention' | 'running' | 'unread';

export const TRAY_PANEL_CHANNELS = {
  /** main → panel: the full feed, pushed on the same debounce as the old menu rebuild. */
  sessions: 'tray-panel:sessions',
  /** panel → main (invoke): initial feed on mount, before the first push lands. */
  requestSessions: 'tray-panel:request-sessions',
  /** panel → main: focus the session's workspace window and navigate to it. */
  selectSession: 'tray-panel:select-session',
  /** panel → main: start a new session in the frontmost project window. */
  newSession: 'tray-panel:new-session',
  /** panel → main: focus a project window. */
  openApp: 'tray-panel:open-app',
  /** panel → main: mark every unread session read. */
  clearAllUnread: 'tray-panel:clear-all-unread',
  /** panel → main: dismiss the panel (Escape, or after an action). */
  close: 'tray-panel:close',
} as const;

export function emptyTrayPanelFeed(): TrayPanelFeed {
  return { needsAttention: [], running: [], unread: [] };
}

export function trayPanelFeedTotal(feed: TrayPanelFeed): number {
  return feed.needsAttention.length + feed.running.length + feed.unread.length;
}
