/**
 * Quick-open matching shared by the desktop dialog and the browser palette.
 *
 * Logic only -- no React. The desktop's `UnifiedQuickOpen` is 3000 lines of
 * Jotai atoms, IPC calls, sessions, prompts and workspace projects and cannot
 * be lifted whole; what would actually drift between the two hosts is *what
 * matches and in what order*, and that is what lives here.
 */

export {
  findTrackersByIssueKey,
  matchesIssueKey,
  matchesTrackerText,
  parseIssueKeyQuery,
} from './issueKeyQuery';
export type {
  IssueKeyCandidate,
  ParsedIssueKeyQuery,
  TrackerTextCandidate,
} from './issueKeyQuery';

export { rankQuickOpenEntries, QUICK_OPEN_SCORES } from './quickOpenRanking';
export type {
  QuickOpenEntry,
  QuickOpenEntryKind,
  RankQuickOpenOptions,
} from './quickOpenRanking';
