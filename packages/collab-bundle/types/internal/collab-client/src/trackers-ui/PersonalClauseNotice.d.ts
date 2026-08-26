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
import { type PersonalViewClause } from '../trackers/index';
export interface PersonalClauseNoticeProps {
    clauses: readonly PersonalViewClause[];
}
export declare function PersonalClauseNotice({ clauses }: PersonalClauseNoticeProps): React.JSX.Element | null;
