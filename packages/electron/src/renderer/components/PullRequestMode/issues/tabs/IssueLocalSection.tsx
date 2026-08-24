/**
 * One titled card on the Local tab. Shared by IssueLocalTab and the adoption
 * panel so the tab reads as one surface rather than two stacked designs.
 */

import type { JSX, ReactNode } from 'react';

interface IssueLocalSectionProps {
  heading: string;
  /** Small right-aligned annotation (counts, timestamps, scope reminders). */
  note?: string;
  children: ReactNode;
  testId?: string;
}

export function IssueLocalSection({
  heading,
  note,
  children,
  testId,
}: IssueLocalSectionProps): JSX.Element {
  return (
    <div className="rounded-lg border border-nim bg-nim-secondary px-3 py-2.5" data-testid={testId}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-nim-faint">
          {heading}
        </span>
        {note && <span className="text-[10.5px] text-nim-faint">{note}</span>}
      </div>
      {children}
    </div>
  );
}
