/**
 * The unshared-subject publish prompt.
 *
 * A recipient cannot review something that only exists on the author's machine,
 * so sending implies publishing the subject to the team. That must be an
 * explicit act: this prompt names exactly which artifacts become visible and
 * publishes only when the author presses its own confirm button. There is no
 * silent auto-publish, and no dead end -- the confirm is right here rather than
 * somewhere else in the app.
 */

import React, { useState } from 'react';
import type { FeedbackComposeSubject } from './feedbackComposeDraft';

const WarningGlyph: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="shrink-0 mt-0.5">
    <path d="M7 1.8 13 12.2H1L7 1.8Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    <path d="M7 5.6v2.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    <circle cx="7" cy="10.2" r="0.7" fill="currentColor" />
  </svg>
);

export interface FeedbackComposePublishPromptProps {
  subjects: FeedbackComposeSubject[];
  /** Already-agreed subject ids; when it covers everything the prompt is settled. */
  confirmedSourceIds: string[];
  recipientNames: string[];
  /** Publish these subjects and send in one explicit action. */
  onConfirmAndSend: () => void;
  /** Set true when the author presses the footer primary while unconfirmed. */
  forceExpanded?: boolean;
  disabled?: boolean;
}

export const FeedbackComposePublishPrompt: React.FC<FeedbackComposePublishPromptProps> = ({
  subjects,
  confirmedSourceIds,
  recipientNames,
  onConfirmAndSend,
  forceExpanded,
  disabled,
}) => {
  const [expanded, setExpanded] = useState(false);
  const isExpanded = expanded || forceExpanded === true;

  const confirmed = new Set(confirmedSourceIds);
  const outstanding = subjects.filter((subject) => !confirmed.has(subject.ref.sourceId));
  const settled = outstanding.length === 0;

  const who =
    recipientNames.length === 0
      ? 'the people you ask'
      : recipientNames.length === 1
        ? recipientNames[0]
        : `${recipientNames.slice(0, -1).join(', ')} and ${recipientNames[recipientNames.length - 1]}`;

  return (
    <div
      data-testid="feedback-compose-publish-prompt"
      data-settled={settled}
      className={`feedback-compose-publish-prompt flex gap-2.5 items-start rounded-md border px-3 py-2.5 ${
        settled
          ? 'border-[color-mix(in_srgb,var(--nim-success)_35%,transparent)] bg-[color-mix(in_srgb,var(--nim-success)_10%,transparent)] text-nim-success'
          : 'border-[color-mix(in_srgb,var(--nim-warning)_35%,transparent)] bg-[color-mix(in_srgb,var(--nim-warning)_10%,transparent)] text-nim-warning'
      }`}
    >
      <WarningGlyph />
      <div className="flex flex-col gap-2 min-w-0 flex-1">
        <p className="text-xs leading-relaxed text-nim-muted select-text">
          {settled ? (
            <>
              <span className="font-semibold text-nim">
                {subjects.length === 1
                  ? '1 subject will be published to the team on send.'
                  : `${subjects.length} subjects will be published to the team on send.`}
              </span>{' '}
              Nothing has been published yet.
            </>
          ) : (
            <>
              <span className="font-semibold text-nim">
                {outstanding.length === 1
                  ? '1 subject is not shared with your team yet.'
                  : `${outstanding.length} subjects are not shared with your team yet.`}
              </span>{' '}
              {who} cannot open {outstanding.length === 1 ? 'it' : 'them'} as-is. Sending will
              publish {outstanding.length === 1 ? 'it' : 'them'} to the team.
            </>
          )}
        </p>

        {!isExpanded && !settled && (
          <button
            type="button"
            data-testid="feedback-compose-publish-disclose"
            onClick={() => setExpanded(true)}
            className="self-start text-xs text-nim-primary bg-transparent border-none p-0 cursor-pointer hover:underline"
          >
            See exactly what becomes visible
          </button>
        )}

        {isExpanded && !settled && (
          <>
            <ul className="feedback-compose-publish-list flex flex-col gap-1 m-0 pl-0 list-none">
              {outstanding.map((subject) => (
                <li
                  key={subject.ref.sourceId}
                  data-testid="feedback-compose-publish-item"
                  className="text-xs text-nim truncate select-text"
                >
                  {subject.label}
                  {subject.context && (
                    <span className="text-nim-faint"> · {subject.context}</span>
                  )}
                </li>
              ))}
            </ul>
            <button
              type="button"
              data-testid="feedback-compose-publish-confirm"
              onClick={onConfirmAndSend}
              disabled={disabled}
              className="self-start px-3 py-1.5 rounded-md text-[13px] font-medium cursor-pointer border-none transition-colors duration-150 hover:opacity-90 bg-nim-primary text-nim-on-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {outstanding.length === 1
                ? 'Publish this and send'
                : `Publish these ${outstanding.length} and send`}
            </button>
          </>
        )}
      </div>
    </div>
  );
};
