/**
 * Delivery settings: visibility, deadline, and the wake policy.
 *
 * Setting a deadline here promotes the draft to Tier 2, which is why this block
 * is reachable from Tier 1's collapsed line as well -- the author opens the
 * settings, picks a due date, and the surface grows around them.
 *
 * "Send via" is stated rather than offered: the protocol addresses recipients
 * as org members, so every request is delivered as a direct message today. A
 * dropdown with one reachable option would imply a choice that does not exist.
 */

import React from 'react';
import type { FeedbackRequestVisibility } from '@nimbalyst/collab-protocol';
import { FeedbackComposeMenu, FeedbackComposeMenuItem } from './FeedbackComposeMenu';
import type { FeedbackComposeQuorumMode } from './feedbackComposeDraft';

const DAY_MS = 24 * 60 * 60 * 1000;

export function formatDeadline(deadline: number): string {
  return new Date(deadline).toLocaleString(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** End-of-day choices relative to `now`, so "Thursday" means Thursday evening. */
export function deadlineChoices(now: number): Array<{ label: string; value: number | undefined }> {
  const endOfDay = (offsetDays: number): number => {
    const date = new Date(now + offsetDays * DAY_MS);
    date.setHours(17, 0, 0, 0);
    return date.getTime();
  };
  return [
    { label: 'No deadline', value: undefined },
    { label: 'Today, 5:00 PM', value: endOfDay(0) },
    { label: 'Tomorrow, 5:00 PM', value: endOfDay(1) },
    { label: 'In 3 days', value: endOfDay(3) },
    { label: 'In a week', value: endOfDay(7) },
  ];
}

const VISIBILITY_LABELS: Record<FeedbackRequestVisibility, string> = {
  hiddenUntilAnswered: 'After each person responds',
  open: 'To everyone asked',
};

const Setting: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="feedback-compose-setting flex items-center gap-2">
    <span className="text-xs text-nim-muted flex-1 min-w-0">{label}</span>
    {children}
  </div>
);

export interface FeedbackComposeDeliveryProps {
  visibility: FeedbackRequestVisibility;
  deadline?: number;
  quorumMode: FeedbackComposeQuorumMode;
  /** Single-recipient requests have no quorum choice to make. */
  recipientCount: number;
  now: number;
  onVisibilityChange: (visibility: FeedbackRequestVisibility) => void;
  onDeadlineChange: (deadline: number | undefined) => void;
  onQuorumModeChange: (mode: FeedbackComposeQuorumMode) => void;
  disabled?: boolean;
}

export const FeedbackComposeDelivery: React.FC<FeedbackComposeDeliveryProps> = ({
  visibility,
  deadline,
  quorumMode,
  recipientCount,
  now,
  onVisibilityChange,
  onDeadlineChange,
  onQuorumModeChange,
  disabled,
}) => (
  <div className="feedback-compose-delivery grid grid-cols-2 gap-x-4 gap-y-2 @[max-460px]/feedback-compose:grid-cols-1">
    <Setting label="Send via">
      <span className="text-xs text-nim px-2 py-1">Direct message</span>
    </Setting>

    <Setting label="Answers visible">
      <FeedbackComposeMenu
        ariaLabel="Choose when answers become visible"
        triggerTestId="feedback-compose-visibility"
        disabled={disabled}
        trigger={VISIBILITY_LABELS[visibility]}
      >
        {(close) =>
          (Object.keys(VISIBILITY_LABELS) as FeedbackRequestVisibility[]).map((option) => (
            <FeedbackComposeMenuItem
              key={option}
              selected={option === visibility}
              onSelect={() => {
                onVisibilityChange(option);
                close();
              }}
            >
              {VISIBILITY_LABELS[option]}
            </FeedbackComposeMenuItem>
          ))
        }
      </FeedbackComposeMenu>
    </Setting>

    <Setting label="Due">
      <FeedbackComposeMenu
        ariaLabel="Choose a deadline"
        triggerTestId="feedback-compose-deadline"
        disabled={disabled}
        trigger={deadline === undefined ? 'No deadline' : formatDeadline(deadline)}
      >
        {(close) =>
          deadlineChoices(now).map((choice) => (
            <FeedbackComposeMenuItem
              key={choice.label}
              testId="feedback-compose-deadline-choice"
              selected={choice.value === deadline}
              onSelect={() => {
                onDeadlineChange(choice.value);
                close();
              }}
            >
              {choice.label}
            </FeedbackComposeMenuItem>
          ))
        }
      </FeedbackComposeMenu>
    </Setting>

    <Setting label="Wake this session">
      {recipientCount > 1 ? (
        <FeedbackComposeMenu
          ariaLabel="Choose when this session wakes"
          triggerTestId="feedback-compose-wake"
          disabled={disabled}
          trigger={quorumMode === 'first' ? 'On the first reply' : 'When everyone replies'}
        >
          {(close) => (
            <>
              <FeedbackComposeMenuItem
                selected={quorumMode === 'first'}
                onSelect={() => {
                  onQuorumModeChange('first');
                  close();
                }}
              >
                On the first reply
              </FeedbackComposeMenuItem>
              <FeedbackComposeMenuItem
                selected={quorumMode === 'all'}
                onSelect={() => {
                  onQuorumModeChange('all');
                  close();
                }}
              >
                When everyone replies
              </FeedbackComposeMenuItem>
            </>
          )}
        </FeedbackComposeMenu>
      ) : (
        <span className="text-xs text-nim px-2 py-1">On the reply</span>
      )}
    </Setting>
  </div>
);
