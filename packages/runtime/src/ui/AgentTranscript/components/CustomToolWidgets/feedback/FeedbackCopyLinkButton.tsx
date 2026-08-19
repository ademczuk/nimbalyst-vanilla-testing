/**
 * "Copy link" — the delivery mechanism for a feedback request.
 *
 * A request addressed to someone who is not holding a live desktop socket
 * reaches them through no channel at all: there is no transactional mail, and
 * team deliveries are not wired to push. So the pasteable link is not a
 * convenience on these surfaces, it is how the request arrives, and it gets a
 * plain labelled button on the two places the author sees a request — the
 * compose confirmation and the results tab — rather than a menu entry.
 *
 * It lives here rather than in `InteractiveWidgetChrome` because that module is
 * deliberately presentation-only, and this reaches the clipboard.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

import { copyToClipboard } from '../../../../../utils/clipboard';

export interface FeedbackCopyLinkButtonProps {
  /** The console URL for the request. Built by the caller, never here. */
  url: string;
  label?: string;
  testId?: string;
  rootClassName?: string;
}

/** How long the button confirms the copy before returning to its label. */
const COPIED_LABEL_MS = 2000;

export const FeedbackCopyLinkButton: React.FC<FeedbackCopyLinkButtonProps> = ({
  url,
  label = 'Copy link',
  testId = 'feedback-copy-link',
  rootClassName = 'feedback-copy-link',
}) => {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
  }, []);

  const handleCopy = useCallback(async () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
    try {
      await copyToClipboard(url);
      setStatus('copied');
    } catch (error) {
      // The link is on screen either way, so a failed clipboard is a label
      // change rather than a dead end.
      console.error('[FeedbackCopyLinkButton] Failed to copy link:', error);
      setStatus('failed');
    }
    resetTimer.current = setTimeout(() => setStatus('idle'), COPIED_LABEL_MS);
  }, [url]);

  return (
    <button
      type="button"
      data-testid={testId}
      data-status={status}
      title={url}
      onClick={() => { void handleCopy(); }}
      className={`${rootClassName} px-3 py-1.5 rounded-md text-[13px] cursor-pointer border border-nim transition-colors duration-150 hover:bg-nim-hover bg-nim-tertiary text-nim-muted`}
    >
      {status === 'copied' ? 'Link copied' : status === 'failed' ? 'Copy failed' : label}
    </button>
  );
};
