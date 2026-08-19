/**
 * Recipient list with per-person ask chips.
 *
 * The chips are how the role-split review (designer reviews visuals, PM reviews
 * requirements, architect reviews the approach) is expressed without inventing
 * a functional-role entity: one subject, different ask sets addressed to
 * different people. Protocol assignments are already discriminated per user for
 * exactly this.
 *
 * Adding a second person here is also what promotes the surface from Tier 1 to
 * Tier 2 -- the promotion is the disclosure, not a separate command.
 */

import React from 'react';
import type { FeedbackAsk, FeedbackRequestRecipient } from '@nimbalyst/collab-protocol';
import { FeedbackComposeMenu, FeedbackComposeMenuItem } from './FeedbackComposeMenu';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export const RecipientAvatar: React.FC<{ name: string; className?: string }> = ({
  name,
  className,
}) => (
  <span
    aria-hidden="true"
    className={`feedback-compose-avatar shrink-0 flex items-center justify-center rounded-full text-[0.625rem] font-semibold text-nim-primary bg-[color-mix(in_srgb,var(--nim-primary)_18%,transparent)] ${
      className ?? 'w-6 h-6'
    }`}
  >
    {initials(name)}
  </span>
);

/**
 * The add-a-person affordance. Shared by both tiers: at Tier 1 it is the single
 * control that can promote the draft to Tier 2.
 */
export const FeedbackComposeAddRecipient: React.FC<{
  candidates: FeedbackRequestRecipient[];
  onAdd: (recipient: FeedbackRequestRecipient) => void;
  disabled?: boolean;
}> = ({ candidates, onAdd, disabled }) => (
  <FeedbackComposeMenu
    ariaLabel="Add a person to ask"
    triggerTestId="feedback-compose-add-recipient"
    disabled={disabled}
    trigger={
      <span className="flex items-center gap-1.5 text-nim-primary">
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
          <path d="M6 2.5v7M2.5 6h7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        Add people
      </span>
    }
  >
    {(close) =>
      candidates.length === 0 ? (
        <div className="px-3 py-2 text-xs text-nim-muted">No other teammates available yet.</div>
      ) : (
        candidates.map((candidate) => (
          <FeedbackComposeMenuItem
            key={candidate.userId}
            testId="feedback-compose-candidate"
            onSelect={() => {
              onAdd(candidate);
              close();
            }}
          >
            <span className="flex items-center gap-2">
              <RecipientAvatar name={candidate.name} className="w-5 h-5" />
              {candidate.name}
            </span>
          </FeedbackComposeMenuItem>
        ))
      )
    }
  </FeedbackComposeMenu>
);

export interface FeedbackComposeRecipientsProps {
  recipients: FeedbackRequestRecipient[];
  asks: FeedbackAsk[];
  /** Candidates from the org directory, minus those already added. */
  candidates: FeedbackRequestRecipient[];
  isAskAssigned: (askId: string, userId: string) => boolean;
  /** Omitted at Tier 1, where one person answers everything. */
  onToggleAssignment?: (askId: string, userId: string) => void;
  onAdd: (recipient: FeedbackRequestRecipient) => void;
  onRemove: (userId: string) => void;
  disabled?: boolean;
}

export const FeedbackComposeRecipients: React.FC<FeedbackComposeRecipientsProps> = ({
  recipients,
  asks,
  candidates,
  isAskAssigned,
  onToggleAssignment,
  onAdd,
  onRemove,
  disabled,
}) => (
  <div className="feedback-compose-recipients flex flex-col gap-1.5">
    {recipients.map((recipient) => (
      <div
        key={recipient.userId}
        data-testid="feedback-compose-recipient"
        className="feedback-compose-recipient flex items-center gap-2.5 p-2 border border-nim rounded-md bg-nim-secondary"
      >
        <RecipientAvatar name={recipient.name} />
        <span className="text-[0.8125rem] font-medium text-nim truncate select-text">
          {recipient.name}
        </span>

        {onToggleAssignment && (
          <span className="feedback-compose-ask-chips ml-auto flex gap-1">
            {asks.map((ask, index) => {
              const assigned = isAskAssigned(ask.id, recipient.userId);
              return (
                <button
                  key={ask.id}
                  type="button"
                  data-testid="feedback-compose-ask-chip"
                  data-assigned={assigned}
                  title={`${ask.label} — ${assigned ? 'assigned to' : 'not assigned to'} ${recipient.name}`}
                  onClick={() => onToggleAssignment(ask.id, recipient.userId)}
                  disabled={disabled}
                  className={`feedback-compose-ask-chip font-mono text-[0.625rem] font-semibold rounded px-1.5 py-0.5 cursor-pointer border-none disabled:opacity-50 disabled:cursor-not-allowed ${
                    assigned
                      ? 'bg-nim-primary text-nim-on-primary'
                      : 'bg-nim-tertiary text-nim-muted hover:bg-nim-hover'
                  }`}
                >
                  {`Q${index + 1}`}
                </button>
              );
            })}
          </span>
        )}

        <button
          type="button"
          data-testid="feedback-compose-remove-recipient"
          aria-label={`Remove ${recipient.name}`}
          onClick={() => onRemove(recipient.userId)}
          disabled={disabled}
          className={`shrink-0 text-nim-faint hover:text-nim cursor-pointer bg-transparent border-none p-0 leading-none disabled:opacity-50 ${
            onToggleAssignment ? '' : 'ml-auto'
          }`}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    ))}

    <div className="feedback-compose-add-recipient">
      <FeedbackComposeAddRecipient candidates={candidates} onAdd={onAdd} disabled={disabled} />
    </div>
  </div>
);
