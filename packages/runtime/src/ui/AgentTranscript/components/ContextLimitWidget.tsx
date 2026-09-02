import React, { useState, useEffect } from 'react';
import type { ContextFailureKind } from './contextFailureDetection';

// Inject context limit widget styles once (for color-mix patterns)
const injectContextLimitStyles = () => {
  const styleId = 'context-limit-widget-styles';
  if (document.getElementById(styleId)) return;

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    .context-limit-widget {
      background-color: color-mix(in srgb, var(--nim-error) 8%, transparent);
      border: 1px solid color-mix(in srgb, var(--nim-error) 25%, transparent);
    }
  `;
  document.head.appendChild(style);
};

interface ContextLimitWidgetProps {
  sessionId?: string;
  isLastMessage?: boolean; // Only show compact button on the last message
  /** How the session got here. See contextFailureDetection.ts. */
  variant?: ContextFailureKind;
  /**
   * Raw failure text this widget replaced. Only shown for a failed compaction,
   * where the detail names who refused (#1414: the reporter's 400 came from a
   * router in front of the model, and nothing else in the transcript said so).
   */
  detail?: string;
  /** Callback to trigger /compact. Awaited so the button recovers on failure. */
  onCompact?: () => void | Promise<void>;
}

export const ContextLimitWidget: React.FC<ContextLimitWidgetProps> = ({
  sessionId,
  isLastMessage = false,
  variant = 'context-limit',
  detail,
  onCompact,
}) => {
  const [isCompacting, setIsCompacting] = useState(false);

  // Inject styles on mount
  useEffect(() => {
    injectContextLimitStyles();
  }, []);

  // #1414: always hand the button back. It used to latch on true, so a
  // compaction that failed -- the one case where the user needs to try
  // something else -- left the only affordance stuck on "Compacting...".
  const handleCompact = async () => {
    setIsCompacting(true);
    try {
      await onCompact?.();
    } finally {
      setIsCompacting(false);
    }
  };

  const compactionFailed = variant === 'compaction-failed';

  const title = compactionFailed ? 'Compaction failed' : 'Context limit exceeded';

  const message = compactionFailed
    ? (isLastMessage
        ? 'The conversation could not be summarized, so the context was not reduced. Retrying sometimes works; otherwise start a new session to keep going.'
        : 'A compaction attempt failed at this point in the conversation.')
    : (isLastMessage
        ? 'This conversation has grown too large for the model\'s context window. Compact the conversation history to continue.'
        : 'This conversation exceeded the model\'s context window at this point.');

  const idleLabel = compactionFailed ? 'Try again' : 'Compact';
  const busyLabel = compactionFailed ? 'Retrying...' : 'Compacting...';

  // This widget renders instead of the message it matched, so without this the
  // only description of the failure is thrown away.
  const failureDetail = compactionFailed ? detail?.trim() : undefined;

  return (
    <div className="context-limit-widget my-4 p-4 rounded-lg flex flex-col gap-3">
      <div className="context-limit-header flex items-center gap-2">
        <span className="context-limit-icon flex items-center justify-center w-5 h-5 rounded-full bg-[var(--nim-error)] text-white text-xs font-bold">!</span>
        <span className="context-limit-title text-[var(--nim-error)] text-sm font-semibold">{title}</span>
      </div>

      <div className="context-limit-message text-[var(--nim-text-muted)] text-[0.85rem] leading-relaxed">
        {message}
      </div>

      {failureDetail && (
        <div className="context-limit-detail select-text text-[var(--nim-text-faint)] text-[0.78rem] font-mono whitespace-pre-wrap break-words max-h-24 overflow-y-auto">
          {failureDetail}
        </div>
      )}

      {/* No handler means the provider declared compaction unsupported. Offering
          the button anyway is the #1252 failure mode: it looks like it worked
          while the context keeps growing. */}
      {isLastMessage && onCompact && (
        <div className="context-limit-actions flex gap-3 mt-1">
          <button
            onClick={handleCompact}
            disabled={isCompacting}
            className="compact-button py-2.5 px-4 rounded-md text-sm font-semibold cursor-pointer transition-all border-none bg-[var(--nim-primary)] text-white whitespace-nowrap hover:bg-[var(--nim-primary-hover)] disabled:cursor-not-allowed disabled:bg-[var(--nim-text-faint)] disabled:opacity-60"
          >
            {isCompacting ? busyLabel : idleLabel}
          </button>
        </div>
      )}

      {isLastMessage && !onCompact && (
        <div className="context-limit-unsupported text-[var(--nim-text-faint)] text-[0.8rem]">
          This provider cannot compact from Nimbalyst. Start a new session to continue.
        </div>
      )}
    </div>
  );
};
