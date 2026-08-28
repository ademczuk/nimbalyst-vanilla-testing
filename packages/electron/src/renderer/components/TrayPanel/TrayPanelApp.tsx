import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import {
  TRAY_PANEL_CHANNELS,
  trayPanelFeedTotal,
  type TrayPanelSectionState,
  type TrayPanelSession,
} from '../../../shared/traySessions';
import { initTrayPanelListener, trayPanelFeedAtom } from '../../store/listeners/trayPanelListeners';
import { SessionAttentionRow } from '../AgenticCoding/SessionAttentionRow';

/**
 * The menu-bar sessions panel.
 *
 * Its own renderer (`?mode=tray-panel`) with an empty Jotai store, so it takes
 * everything from the main process rather than the workspace-scoped session
 * atoms the in-app popover reads. The rows are the same component, so the two
 * surfaces stay visually identical.
 */

const STATE_STYLES: Record<TrayPanelSectionState, { label: string; colorClass: string; dotClass: string }> = {
  attention: {
    label: 'Needs attention',
    colorClass: 'text-nim-warning',
    dotClass: 'bg-[var(--nim-warning)]',
  },
  running: {
    label: 'Running',
    colorClass: 'text-nim-success',
    dotClass: 'bg-[var(--nim-success)]',
  },
  unread: {
    label: 'Unread',
    colorClass: 'text-nim-primary',
    dotClass: 'bg-[var(--nim-primary)]',
  },
};

/** Unread is the bucket that historically ran the menu off the screen. */
const UNREAD_COLLAPSE_AT = 6;

/**
 * The app's focus ring, on every control in the panel.
 *
 * Without it Chromium falls back to `outline: auto`, which it paints as *two*
 * strokes -- a white contrast ring inside an accent-coloured one -- sitting
 * outside the button. Sampled off a report of the New Session button: 2px of
 * `#ffffff` wrapped in 4px of `#da9b35`. That reads as a stray double outline
 * rather than a focus indicator. Matches the convention the rest of the app
 * already uses, and the inset offset keeps the ring inside the button's own box
 * so nothing shifts when it appears.
 */
const FOCUS_RING = 'focus:outline-none focus-visible:outline-2 focus-visible:outline-[var(--nim-border-focus)] focus-visible:outline-offset-[-2px]';

function TrayStatusIndicator({
  session,
  state,
}: {
  session: TrayPanelSession;
  state: TrayPanelSectionState;
}) {
  if (session.hasError) {
    return (
      <div className="flex h-5 w-5 items-center justify-center text-[var(--nim-error)]" title="Session error">
        <MaterialSymbol icon="error" size={14} />
      </div>
    );
  }
  if (session.hasPendingPrompt) {
    return (
      <div className="flex h-5 w-5 animate-pulse items-center justify-center text-[var(--nim-warning)]" title="Waiting for your response">
        <MaterialSymbol icon="contact_support" size={14} />
      </div>
    );
  }
  // Every row in the Running section spins, not just the ones mid-stream:
  // `isStreaming` is only true between streaming events, so a session waiting on
  // a tool call rendered as a bare row with no indicator at all.
  if (state === 'running') {
    return (
      <div className="flex h-5 w-5 items-center justify-center text-[var(--nim-primary)] opacity-80" title="Running">
        <MaterialSymbol icon="progress_activity" size={14} className="animate-spin" />
      </div>
    );
  }
  if (state === 'unread') {
    return (
      <div className="flex h-5 w-5 items-center justify-center text-[var(--nim-primary)]" title="Unread response">
        <MaterialSymbol icon="circle" size={8} fill />
      </div>
    );
  }
  return null;
}

export function TrayPanelApp() {
  const feed = useAtomValue(trayPanelFeedAtom);
  const [showAllUnread, setShowAllUnread] = useState(false);
  // Re-render on a timer so the relative-time labels stay honest while the
  // panel sits open; the feed itself only pushes on session state changes.
  const [, setNow] = useState(Date.now());
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => initTrayPanelListener(), []);

  /*
   * Park focus on the panel itself, on open and again whenever the panel loses
   * focus.
   *
   * The window is created once and reused: main hides it on blur and shows it
   * again on the next tray click, so DOM focus survives in between. Click New
   * Session once and that button keeps focus forever after, and Chromium
   * re-asserts a focus ring on it every time the window is re-activated -- which
   * is the stray outline on a button the user never touched this time round.
   * (Verified on a real window: without this, re-opening lands on the clicked
   * button; with it, on the root.)
   *
   * The root is `tabIndex={-1}` and `outline-none`. The `outline-none` is
   * load-bearing, not tidiness -- a programmatically focused element does match
   * `:focus-visible`, so without it the ring would simply move to the panel.
   * Tab still reaches New Session first, and Escape is handled on the window
   * rather than by a focused control.
   */
  useEffect(() => {
    const parkFocus = () => rootRef.current?.focus({ preventScroll: true });
    parkFocus();
    window.addEventListener('blur', parkFocus);
    return () => window.removeEventListener('blur', parkFocus);
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') window.electronAPI.send(TRAY_PANEL_CHANNELS.close);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleSelect = useCallback((sessionId: string) => {
    const all = [...feed.needsAttention, ...feed.running, ...feed.unread];
    const session = all.find((candidate) => candidate.sessionId === sessionId);
    if (!session) return;
    window.electronAPI.send(TRAY_PANEL_CHANNELS.selectSession, {
      sessionId: session.sessionId,
      workspacePath: session.workspacePath,
    });
  }, [feed]);

  const sections = useMemo(() => ([
    { state: 'attention' as const, sessions: feed.needsAttention },
    { state: 'running' as const, sessions: feed.running },
    { state: 'unread' as const, sessions: feed.unread },
  ]).filter((section) => section.sessions.length > 0), [feed]);

  const total = trayPanelFeedTotal(feed);
  const summary = total === 0
    ? 'Nothing needs you'
    : [
      feed.needsAttention.length > 0 ? `${feed.needsAttention.length} need attention` : null,
      feed.running.length > 0 ? `${feed.running.length} running` : null,
      feed.unread.length > 0 ? `${feed.unread.length} unread` : null,
    ].filter(Boolean).join(' · ');

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      className="tray-panel flex h-screen w-screen flex-col overflow-hidden rounded-xl border border-nim text-nim outline-none"
      data-testid="tray-panel"
      data-component="TrayPanelApp"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-nim px-3.5 py-2.5">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-nim">Sessions</div>
          <div className="truncate text-[11px] text-nim-muted" data-testid="tray-panel-summary">{summary}</div>
        </div>
        <button
          type="button"
          className={`tray-panel-new-session flex shrink-0 items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-nim-muted transition-colors hover:bg-nim-tertiary hover:text-nim ${FOCUS_RING}`}
          onClick={() => window.electronAPI.send(TRAY_PANEL_CHANNELS.newSession)}
          data-testid="tray-panel-new-session"
        >
          <MaterialSymbol icon="add" size={14} />
          New Session
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-1" data-testid="tray-panel-list">
        {sections.length === 0 && (
          <div className="px-3.5 py-6 text-center text-[12px] text-nim-faint" data-testid="tray-panel-empty">
            No sessions need your attention.
          </div>
        )}
        {sections.map(({ state, sessions }) => {
          const style = STATE_STYLES[state];
          const collapsed = state === 'unread' && !showAllUnread && sessions.length > UNREAD_COLLAPSE_AT;
          const visible = collapsed ? sessions.slice(0, UNREAD_COLLAPSE_AT) : sessions;
          return (
            <section key={state} className={`tray-panel-group tray-panel-group--${state}`}>
              <div className={`flex items-center justify-between gap-2 px-3.5 pb-1 pt-2.5 text-[10.5px] font-semibold uppercase tracking-wide ${style.colorClass}`}>
                <span className="flex items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${style.dotClass}`} />
                  <span>{style.label}</span>
                  <span aria-hidden>·</span>
                  <span>{sessions.length}</span>
                </span>
                {state === 'unread' && (
                  <button
                    type="button"
                    className={`tray-panel-mark-all-read rounded px-1.5 py-0.5 text-[10.5px] font-medium normal-case tracking-normal text-nim-muted transition-colors hover:bg-nim-tertiary hover:text-nim ${FOCUS_RING}`}
                    onClick={() => window.electronAPI.send(TRAY_PANEL_CHANNELS.clearAllUnread)}
                    data-testid="tray-panel-mark-all-read"
                  >
                    Mark all as read
                  </button>
                )}
              </div>
              {visible.map((session) => (
                <SessionAttentionRow
                  key={session.sessionId}
                  sessionId={session.sessionId}
                  title={session.title}
                  provider={session.provider}
                  model={session.model}
                  updatedAt={session.updatedAt}
                  workspaceName={session.workspaceName}
                  onSelect={handleSelect}
                  statusSlot={<TrayStatusIndicator session={session} state={state} />}
                />
              ))}
              {collapsed && (
                <button
                  type="button"
                  className={`tray-panel-show-all w-full px-3.5 py-1.5 text-left text-[11px] text-nim-muted transition-colors hover:bg-nim-tertiary hover:text-nim ${FOCUS_RING}`}
                  onClick={() => setShowAllUnread(true)}
                  data-testid="tray-panel-show-all-unread"
                >
                  Show all {sessions.length}
                </button>
              )}
            </section>
          );
        })}
      </div>

      <div className="flex shrink-0 items-center justify-end border-t border-nim px-3.5 py-2">
        <button
          type="button"
          className={`tray-panel-open-app rounded px-2 py-1 text-[11px] font-medium text-nim-muted transition-colors hover:bg-nim-tertiary hover:text-nim ${FOCUS_RING}`}
          onClick={() => window.electronAPI.send(TRAY_PANEL_CHANNELS.openApp)}
          data-testid="tray-panel-open-app"
        >
          Open Nimbalyst
        </button>
      </div>
    </div>
  );
}
