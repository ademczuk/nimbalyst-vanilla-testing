/**
 * Says out loud that part of a shared view could not be evaluated here.
 *
 * A saved view belongs to the team, but its author may have built it on top of
 * their own favorites or their own recently-opened list. A host with no personal
 * lane has three options and only one of them is honest: render zero rows (looks
 * like a broken sync), drop the clause silently (shows more than the author
 * meant, with nothing to explain it), or drop the clause and say so.
 */

import React from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import {
  describePersonalViewClauses,
  type PersonalViewClause,
} from '@nimbalyst/collab-client/trackers';

export interface PersonalClauseNoticeProps {
  clauses: readonly PersonalViewClause[];
}

export function PersonalClauseNotice({ clauses }: PersonalClauseNoticeProps) {
  if (clauses.length === 0) return null;
  return (
    <div
      className="tracker-personal-clause-notice flex items-center gap-2 px-3 py-1.5 border-b border-nim bg-nim-secondary text-[11px] text-nim-muted"
      data-testid="tracker-personal-clause-notice"
      role="status"
    >
      <MaterialSymbol icon="info" size={13} className="shrink-0 text-nim-faint" />
      <span className="min-w-0">{describePersonalViewClauses(clauses)}</span>
    </div>
  );
}
