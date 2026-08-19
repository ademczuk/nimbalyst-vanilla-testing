/**
 * Read-only preview of one ask, as the recipient will see it.
 *
 * The author is reviewing a draft here, not answering it, so nothing is
 * selectable -- the point is that the draft is small enough to check at a
 * glance before it leaves the machine. The respond surface renders the same
 * asks with the shipped interactive field controls.
 */

import React from 'react';
import type { FeedbackAsk } from '@nimbalyst/collab-protocol';
import { WidgetOptionList, WidgetOptionRow } from '../shared/InteractiveWidgetChrome';

const StaticField: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="rounded border border-nim bg-nim-secondary px-2.5 py-2 text-[0.8125rem] text-nim-faint">
    {children}
  </div>
);

export const FeedbackComposeAskPreview: React.FC<{ ask: FeedbackAsk }> = ({ ask }) => {
  switch (ask.type) {
    case 'singleSelect':
      return (
        <WidgetOptionList>
          {ask.options.map((option) => (
            <WidgetOptionRow
              key={option.id}
              label={option.label}
              description={option.description}
              selected={false}
            />
          ))}
          {ask.allowOther && <WidgetOptionRow label="Other" selected={false} />}
        </WidgetOptionList>
      );

    case 'multiSelect':
      return (
        <WidgetOptionList>
          {ask.items.map((item) => (
            <WidgetOptionRow
              key={item.id}
              label={item.title}
              description={item.subtitle}
              selected={false}
            />
          ))}
        </WidgetOptionList>
      );

    case 'reorder':
      return (
        <div className="feedback-compose-reorder-preview flex flex-col gap-1.5">
          {ask.items.map((item, index) => (
            <div
              key={item.id}
              className="flex items-center gap-2.5 rounded border border-nim bg-nim-secondary px-2.5 py-2"
            >
              <svg width="12" height="12" viewBox="0 0 14 14" className="text-nim-faint shrink-0">
                <circle cx="5" cy="3" r="1" fill="currentColor" />
                <circle cx="9" cy="3" r="1" fill="currentColor" />
                <circle cx="5" cy="7" r="1" fill="currentColor" />
                <circle cx="9" cy="7" r="1" fill="currentColor" />
                <circle cx="5" cy="11" r="1" fill="currentColor" />
                <circle cx="9" cy="11" r="1" fill="currentColor" />
              </svg>
              <span className="font-mono text-[0.6875rem] font-semibold text-nim-muted w-4 text-center shrink-0">
                {index + 1}
              </span>
              <span className="flex flex-col min-w-0">
                <span className="text-[0.8125rem] font-medium text-nim leading-snug">{item.title}</span>
                {item.subtitle && (
                  <span className="text-xs text-nim-muted leading-snug">{item.subtitle}</span>
                )}
              </span>
            </div>
          ))}
        </div>
      );

    case 'editText':
      return <StaticField>{ask.placeholder || ask.initialText || 'Optional…'}</StaticField>;

    case 'confirm':
      return (
        <WidgetOptionList>
          <WidgetOptionRow label="Yes" selected={ask.defaultValue === true} />
          <WidgetOptionRow label="No" selected={ask.defaultValue === false} />
        </WidgetOptionList>
      );

    case 'rating':
      return (
        <StaticField>
          {ask.minLabel ? `${ask.minLabel} · ` : ''}
          {ask.min} to {ask.max}
          {ask.maxLabel ? ` · ${ask.maxLabel}` : ''}
        </StaticField>
      );
  }
};
