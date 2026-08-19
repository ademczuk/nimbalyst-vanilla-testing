/**
 * Subject row: what reviewers will look at, each artifact carrying a
 * shared/not-shared dot.
 *
 * The dot is the whole point of the row -- a recipient cannot review something
 * that only exists on the author's machine, so the sharing state has to be
 * visible before the author sends, not discovered afterwards.
 */

import React from 'react';
import type { FeedbackComposeSubject } from './feedbackComposeDraft';

const ArtifactGlyph: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-nim-faint">
    <path
      d="M3 1.75h5L11 4.5v7.75H3V1.75Z"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinejoin="round"
    />
    <path d="M8 1.75V4.5h3" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
  </svg>
);

export interface FeedbackComposeSubjectsProps {
  subjects: FeedbackComposeSubject[];
  onRemove?: (sourceId: string) => void;
}

export const FeedbackComposeSubjects: React.FC<FeedbackComposeSubjectsProps> = ({
  subjects,
  onRemove,
}) => (
  <div className="feedback-compose-subjects flex gap-2 flex-wrap">
    {subjects.map((subject) => (
      <div
        key={subject.ref.sourceId}
        data-testid="feedback-compose-subject"
        data-shared={subject.shared}
        className="feedback-compose-subject flex items-center gap-2 min-w-0 max-w-full bg-nim-secondary border border-nim rounded-md py-1.5 pl-2 pr-2.5"
      >
        <span className="shrink-0 flex items-center justify-center w-6 h-6 rounded bg-nim border border-nim">
          <ArtifactGlyph />
        </span>
        <span className="flex flex-col min-w-0">
          <span className="text-xs font-medium text-nim truncate select-text">{subject.label}</span>
          <span className="text-[0.6875rem] text-nim-faint truncate">
            {subject.context ? `${subject.context} · ` : ''}
            {subject.shared ? 'shared' : 'not shared'}
          </span>
        </span>
        <span
          aria-hidden="true"
          className={`shrink-0 w-1.5 h-1.5 rounded-full ${
            subject.shared ? 'bg-nim-success' : 'bg-nim-warning'
          }`}
        />
        {onRemove && (
          <button
            type="button"
            aria-label={`Remove ${subject.label} from the subject`}
            onClick={() => onRemove(subject.ref.sourceId)}
            className="shrink-0 text-nim-faint hover:text-nim cursor-pointer bg-transparent border-none p-0 leading-none"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
    ))}
  </div>
);
