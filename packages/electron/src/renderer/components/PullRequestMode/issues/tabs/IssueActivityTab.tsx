/**
 * IssueActivityTab — the GitHub timeline for an issue: labels, assignments,
 * cross-references, and closing events, newest last.
 */

import type { JSX } from 'react';
import { useEffect, useMemo } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import {
  githubIssueDetailErrorAtom,
  githubIssueDetailLoadingAtom,
  githubIssueTimelineAtom,
} from '../../../../store/atoms/githubIssues';
import {
  getGithubIssueService,
  type GithubIssueEventRow,
  type GithubIssueRow,
} from '../../../../services/RendererGithubIssueService';
import { formatRelative } from '../../prFormat';

interface IssueActivityTabProps {
  workspaceId: string;
  remote: string;
  issue: GithubIssueRow;
  refreshToken: number;
}

const EVENT_ICONS: Record<string, string> = {
  labeled: 'label',
  unlabeled: 'label_off',
  assigned: 'person_add',
  unassigned: 'person_remove',
  closed: 'check_circle',
  reopened: 'restart_alt',
  renamed: 'edit',
  milestoned: 'flag',
  demilestoned: 'flag',
  referenced: 'link',
  'cross-referenced': 'call_merge',
  locked: 'lock',
  unlocked: 'lock_open',
  commented: 'chat_bubble',
};

/**
 * Event payloads vary per event type; pull the one detail that makes the line
 * readable (which label, which milestone, which referencing issue or PR).
 */
function eventDetail(entry: GithubIssueEventRow): string | null {
  const raw = entry.raw as
    | {
        label?: { name?: string };
        assignee?: { login?: string };
        milestone?: { title?: string };
        rename?: { from?: string; to?: string };
        source?: { issue?: { number?: number; pull_request?: unknown } };
      }
    | null;
  if (!raw) return null;
  if (raw.label?.name) return raw.label.name;
  if (raw.assignee?.login) return raw.assignee.login;
  if (raw.milestone?.title) return raw.milestone.title;
  if (raw.rename?.to) return `“${raw.rename.from ?? ''}” → “${raw.rename.to}”`;
  if (raw.source?.issue?.number != null) {
    return `${raw.source.issue.pull_request ? 'PR' : 'issue'} #${raw.source.issue.number}`;
  }
  return null;
}

export function IssueActivityTab({
  workspaceId,
  remote,
  issue,
  refreshToken,
}: IssueActivityTabProps): JSX.Element {
  const loaded = useAtomValue(githubIssueTimelineAtom);
  const setTimeline = useSetAtom(githubIssueTimelineAtom);
  const loading = useAtomValue(githubIssueDetailLoadingAtom);
  const setLoading = useSetAtom(githubIssueDetailLoadingAtom);
  const error = useAtomValue(githubIssueDetailErrorAtom);
  const setError = useSetAtom(githubIssueDetailErrorAtom);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getGithubIssueService()
      .timeline(workspaceId, remote, issue.number)
      .then((rows) => {
        if (!cancelled) setTimeline(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setTimeline([]);
          setError(err instanceof Error ? err.message : 'Failed to load activity');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, remote, issue.number, refreshToken, setTimeline, setLoading, setError]);

  // The atom is global and still holds the previous selection's events while
  // this one loads; each event names the issue it was fetched for.
  const timeline = useMemo(
    () => loaded.filter((entry) => entry.issueId === issue.id),
    [loaded, issue.id],
  );

  return (
    <div
      className="issue-activity-tab block p-4 space-y-1 overflow-y-auto flex-1 min-h-0"
      data-testid="issue-activity-tab"
    >
      {error && (
        <div className="text-nim-error text-sm flex items-center gap-2 mb-2">
          <MaterialSymbol icon="error" size={16} />
          {error}
        </div>
      )}

      {loading && timeline.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-6 text-nim-muted text-sm">
          <div className="spinner w-4 h-4 border-[2px] border-nim-secondary border-t-nim-primary rounded-full animate-spin" />
          Loading activity…
        </div>
      ) : (
        timeline.map((entry) => {
          const detail = eventDetail(entry);
          return (
            <div
              key={entry.id}
              className="flex items-center gap-2 py-1.5 border-b border-nim last:border-b-0 text-xs text-nim-muted select-text"
            >
              <MaterialSymbol
                icon={EVENT_ICONS[entry.event] ?? 'history'}
                size={14}
                className="text-nim-faint shrink-0"
              />
              {entry.actorLogin && <span className="font-medium text-nim">{entry.actorLogin}</span>}
              <span>{entry.event.replace(/[-_]/g, ' ')}</span>
              {detail && <span className="text-nim truncate">{detail}</span>}
              <span className="ml-auto shrink-0 text-nim-faint">
                {formatRelative(entry.createdAt)}
              </span>
            </div>
          );
        })
      )}

      {!loading && timeline.length === 0 && !error && (
        <div className="text-nim-faint text-sm text-center py-4">No activity recorded yet.</div>
      )}
    </div>
  );
}
