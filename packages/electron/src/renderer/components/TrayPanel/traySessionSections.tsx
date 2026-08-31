import React from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import type { TrayPanelSectionState, TrayPanelSession } from '../../../shared/traySessions';

/**
 * The bucket chrome shared by every surface that renders `TrayPanelFeed`.
 *
 * Three of them now: the in-app popover, the tray panel window, and the menu bar
 * island. `SessionAttentionRow` already keeps the *rows* identical by
 * construction; this keeps the section headers and status indicators identical
 * too, rather than by three people remembering to change all three.
 */

export const STATE_STYLES: Record<
  TrayPanelSectionState,
  { label: string; colorClass: string; dotClass: string }
> = {
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
  // Drained, not alarming. A stalled session is a running one with the life
  // gone out of it, so it reads as the running state faded rather than as a
  // fourth kind of emergency competing with the warning and error colours.
  stalled: {
    label: 'Not responding',
    colorClass: 'text-nim-faint',
    dotClass: 'bg-[var(--nim-text-faint)]',
  },
  unread: {
    label: 'Unread',
    colorClass: 'text-nim-primary',
    dotClass: 'bg-[var(--nim-primary)]',
  },
};

export function TrayStatusIndicator({
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
  // Deliberately *not* the spinner. A stalled session is one that still claims
  // to be running, so leaving it spinning would be the indicator repeating the
  // claim this state exists to doubt.
  if (state === 'stalled') {
    return (
      <div className="flex h-5 w-5 items-center justify-center text-nim-faint" title="Running, but silent">
        <MaterialSymbol icon="pause_circle" size={14} />
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

/** `actionSlot` is the seam: the tray panel puts "Mark all as read" here. */
export function TraySessionSectionHeader({
  state,
  count,
  actionSlot,
}: {
  state: TrayPanelSectionState;
  count: number;
  actionSlot?: React.ReactNode;
}) {
  const style = STATE_STYLES[state];
  return (
    <div className={`flex items-center justify-between gap-2 px-3.5 pb-1 pt-2.5 text-[10.5px] font-semibold uppercase tracking-wide ${style.colorClass}`}>
      <span className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${style.dotClass}`} />
        <span>{style.label}</span>
        <span aria-hidden>·</span>
        <span>{count}</span>
      </span>
      {actionSlot}
    </div>
  );
}
