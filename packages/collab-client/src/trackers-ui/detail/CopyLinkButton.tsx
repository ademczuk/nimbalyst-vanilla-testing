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

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import { copyTextToClipboard } from './copyTextToClipboard';

/** Long enough to read, short enough that the resting icon comes back. */
const CONFIRMATION_MS = 1600;

export interface CopyLinkButtonProps {
  /** What lands on the clipboard. */
  value: string;
  /** The button's accessible name in its resting state. */
  label?: string;
  icon?: string;
  className?: string;
  testId?: string;
}

export function CopyLinkButton({
  value,
  label = 'Copy link',
  icon = 'link',
  className,
  testId,
}: CopyLinkButtonProps) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  const copy = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    try {
      await copyTextToClipboard(value);
      setState('copied');
    } catch {
      // Reported rather than swallowed: a denied clipboard permission is the
      // common browser case and looks identical to success otherwise.
      setState('failed');
    }
    timerRef.current = setTimeout(() => setState('idle'), CONFIRMATION_MS);
  }, [value]);

  const spokenLabel =
    state === 'copied'
      ? 'Link copied'
      : state === 'failed'
      ? 'Could not copy link'
      : label;

  return (
    <button
      type="button"
      className={`tracker-copy-link flex size-6 items-center justify-center rounded text-nim-faint hover:bg-nim-hover hover:text-nim ${
        className ?? ''
      }`}
      aria-label={spokenLabel}
      title={spokenLabel}
      data-copy-state={state}
      data-testid={testId}
      onClick={() => {
        void copy();
      }}
    >
      <MaterialSymbol
        icon={
          state === 'copied' ? 'check' : state === 'failed' ? 'error' : icon
        }
        size={16}
      />
      {/* Off-screen rather than absent: the icon swap is the only visible
          feedback, and an icon-only button announces nothing on its own. */}
      <span className="sr-only" role="status" aria-live="polite">
        {state === 'idle' ? '' : spokenLabel}
      </span>
    </button>
  );
}
