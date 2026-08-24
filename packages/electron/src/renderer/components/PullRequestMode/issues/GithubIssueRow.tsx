/**
 * GithubIssueRow — one row in the issues list: number, title, author, age,
 * last activity, labels, comment count, upstream state, and the two local
 * markers — the investigation-status pill and the linked-session dot.
 *
 * Both markers are absent on an untouched issue, and that absence is the
 * point: no pill means no local object was ever created for this issue, which
 * is how a reader sees at a glance that nothing was copied out of GitHub.
 * The row is handed its overlay rather than resolving one, so scrolling the
 * list doesn't re-subscribe every row to the tracker map.
 */

import type { JSX } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import type { GithubIssueRow as GithubIssueRowData } from '../../../services/RendererGithubIssueService';
import { formatRelative } from '../prFormat';
import { GithubTrackerBadge } from '../githubTrackerBadge';
import { githubLabelStyle } from './issueFormat';

interface GithubIssueRowProps {
  issue: GithubIssueRowData;
  selected: boolean;
  onSelect: (id: string) => void;
  /** This issue's `github-issue` overlay; null when it has no local state. */
  overlay?: TrackerRecord | null;
  /** Whether a session is linked to any tracker item about this issue. */
  hasSessions?: boolean;
  /** Whether a local copy of this issue has drifted from upstream. */
  diverged?: boolean;
}

const MAX_LABELS = 3;

export function GithubIssueRow({
  issue,
  selected,
  onSelect,
  overlay,
  hasSessions,
  diverged,
}: GithubIssueRowProps): JSX.Element {
  const closed = issue.state === 'closed';
  const extraLabels = issue.labels.length - MAX_LABELS;

  return (
    <button
      type="button"
      data-testid="issue-row"
      data-issue-number={issue.number}
      onClick={() => onSelect(issue.id)}
      className={`issue-row w-full flex items-center gap-2 px-3 py-2 text-left border-b border-nim transition-colors ${
        selected ? 'bg-nim-active' : 'hover:bg-nim-tertiary'
      }`}
    >
      <span className="flex-1 min-w-0 overflow-hidden">
        <span className="flex items-center gap-1.5 min-w-0">
          <MaterialSymbol
            icon={closed ? 'check_circle' : 'adjust'}
            size={14}
            className={closed ? 'text-nim-faint shrink-0' : 'text-nim-success shrink-0'}
            title={closed ? 'Closed' : 'Open'}
          />
          <span className="truncate text-sm text-nim">{issue.title}</span>
        </span>
        <span className="flex items-center gap-2 mt-0.5 text-[11px] text-nim-faint min-w-0">
          <span className="font-bold font-mono">#{issue.number}</span>
          {issue.authorLogin && <span className="truncate max-w-[120px]">{issue.authorLogin}</span>}
          <span className="shrink-0" title={`Opened ${formatRelative(issue.createdAt)}`}>
            {formatRelative(issue.createdAt)}
          </span>
          {issue.labels.slice(0, MAX_LABELS).map((label) => (
            <span
              key={label.name}
              className="shrink-0 px-1.5 rounded-full border text-[10px] truncate max-w-[110px]"
              style={githubLabelStyle(label.color)}
              title={label.description ?? label.name}
            >
              {label.name}
            </span>
          ))}
          {extraLabels > 0 && <span className="shrink-0">+{extraLabels}</span>}
          <span className="ml-auto shrink-0 flex items-center gap-2">
            {diverged && (
              <MaterialSymbol
                icon="sync_problem"
                size={13}
                className="issue-diverged-marker text-nim-warning shrink-0"
                title="A local copy of this issue has drifted from upstream"
              />
            )}
            {hasSessions && (
              <span
                className="issue-session-dot w-[7px] h-[7px] rounded-full bg-[var(--nim-success)] shrink-0"
                title="Has linked sessions"
              />
            )}
            {overlay && <GithubTrackerBadge record={overlay} compact markerClass="issue-tracker-badge" />}
            {issue.commentsCount > 0 && (
              <span className="flex items-center gap-0.5" title={`${issue.commentsCount} comments`}>
                <MaterialSymbol icon="chat_bubble" size={12} />
                {issue.commentsCount}
              </span>
            )}
            {closed && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold text-nim-on-primary bg-[var(--nim-primary)]">
                {issue.stateReason === 'not_planned' ? 'Not planned' : 'Closed'}
              </span>
            )}
            <span className="shrink-0" title="Last activity">
              {formatRelative(issue.updatedAt)}
            </span>
          </span>
        </span>
      </span>
    </button>
  );
}
