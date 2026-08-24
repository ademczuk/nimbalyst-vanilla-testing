/**
 * GithubIssueDetail — read-only issue detail, following PullRequestDetail:
 * header (number, title, upstream state, author, labels, actions) plus a
 * tabbed body.
 *
 * Conversation and Activity render live upstream data; Local renders the
 * `github-issue` overlay. The header is upstream-only, so it says nothing
 * about local state and needs no overlay wiring.
 *
 * Commenting and close/reopen are deliberately absent: the service exposes
 * both, but writing to GitHub is a later phase. Adopt lives on the Local tab
 * rather than in this header — it is a local escalation, not an upstream act.
 */

import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import { githubIssueDetailAtom } from '../../../store/atoms/githubIssues';
import {
  getGithubIssueService,
  type GithubIssueRow,
} from '../../../services/RendererGithubIssueService';
import { formatRelative } from '../prFormat';
import { PullRequestActionError } from '../PullRequestActionError';
import { isSameIssue } from './issueFilters';
import { githubLabelStyle, issueHtmlUrl, issueStateLabel } from './issueFormat';
import { IssueConversationTab } from './tabs/IssueConversationTab';
import { IssueActivityTab } from './tabs/IssueActivityTab';
import { IssueLocalTab } from './tabs/IssueLocalTab';
import type { IssueOverlayWrite } from './useIssueOverlay';
import type { IssueTrackerContext } from './useIssueTrackerContext';

export type IssueDetailTab = 'conversation' | 'activity' | 'local';

interface GithubIssueDetailProps {
  workspaceId: string;
  remote: string;
  /** The selected row from the list cache. */
  issue: GithubIssueRow;
  activeTab: IssueDetailTab;
  onTabChange: (tab: IssueDetailTab) => void;
  /** Starts an agent session with `/investigate <issue-url>` prefilled. */
  onStartInvestigationSession: () => void;
  /** Tracker items, overlay, and sessions for this issue, resolved by the panel. */
  trackerContext: IssueTrackerContext;
  /** PR numbers referencing this issue, resolved by the panel. */
  linkedPrNumbers: ReadonlyArray<number>;
  /** Applies an overlay write; selecting or viewing an issue never calls it. */
  onOverlayWrite: IssueOverlayWrite;
  /** Loads a linked session into the panel's chat rail. */
  onOpenSession?: (sessionId: string) => void;
}

const TABS: { id: IssueDetailTab; label: string }[] = [
  { id: 'conversation', label: 'Conversation' },
  { id: 'activity', label: 'Activity' },
  { id: 'local', label: 'Local' },
];

const DETAIL_POLL_MS = 60_000;

export function GithubIssueDetail({
  workspaceId,
  remote,
  issue: listRow,
  activeTab,
  onTabChange,
  onStartInvestigationSession,
  trackerContext,
  linkedPrNumbers,
  onOverlayWrite,
  onOpenSession,
}: GithubIssueDetailProps): JSX.Element {
  const fetched = useAtomValue(githubIssueDetailAtom);
  const setFetched = useSetAtom(githubIssueDetailAtom);
  const [refreshToken, setRefreshToken] = useState(0);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Detail-level poll: bump the token every 60s while this panel is mounted,
  // matching the PR detail's cadence.
  useEffect(() => {
    const timer = setInterval(() => setRefreshToken((t) => t + 1), DETAIL_POLL_MS);
    return () => clearInterval(timer);
  }, [listRow.id]);

  // The list read can predate the last upstream edit; `issue:get` fetches and
  // writes through, so the body and labels shown here stay current.
  // The atom is not cleared before each fetch: the identity guard below already
  // refuses another issue's row, and blanking it would make the 60s refresh
  // flicker the header back to the list row's copy.
  useEffect(() => {
    let cancelled = false;
    setFetchError(null);
    getGithubIssueService()
      .get(workspaceId, remote, listRow.number)
      .then((row) => {
        if (!cancelled) setFetched(row);
      })
      .catch((err: unknown) => {
        // A swallowed failure used to leave the previously fetched issue on
        // screen indefinitely. The guard below now falls back to this issue's
        // list row, and the failure is said out loud rather than looking like
        // fresh upstream data.
        if (!cancelled) {
          setFetchError(err instanceof Error ? err.message : 'Failed to load this issue');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, remote, listRow.number, refreshToken, setFetched]);

  // Number alone is not identity: the atom is global, so a row fetched for a
  // different repository (or workspace) sharing this number must not render.
  const issue = isSameIssue(fetched, {
    workspacePath: workspaceId,
    remote,
    number: listRow.number,
  })
    ? fetched
    : listRow;
  const closed = issue.state === 'closed';

  return (
    <div
      className="issue-detail flex flex-col h-full w-full overflow-hidden bg-nim"
      data-testid="issue-detail"
    >
      <div className="shrink-0 border-b border-nim">
        <div className="flex items-start gap-2 px-4 pt-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-sm">
              <span
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                  closed
                    ? 'text-nim-on-primary bg-[var(--nim-primary)]'
                    : 'text-nim-on-primary bg-[var(--nim-success)]'
                }`}
              >
                <MaterialSymbol icon={closed ? 'check_circle' : 'adjust'} size={12} />
                {issueStateLabel(issue)}
              </span>
              <span className="text-nim-faint font-mono">#{issue.number}</span>
              <span className="text-nim font-medium truncate select-text">{issue.title}</span>
            </div>
            <div className="flex items-center gap-2 mt-1 text-[11px] text-nim-faint flex-wrap">
              {issue.authorLogin && <span>{issue.authorLogin}</span>}
              <span>opened {formatRelative(issue.createdAt)}</span>
              <span>· updated {formatRelative(issue.updatedAt)}</span>
              {issue.assignees.length > 0 && (
                <span title="Assignees">
                  · {issue.assignees.map((assignee) => assignee.login).join(', ')}
                </span>
              )}
              {issue.labels.map((label) => (
                <span
                  key={label.name}
                  className="px-1.5 rounded-full border text-[10px]"
                  style={githubLabelStyle(label.color)}
                  title={label.description ?? label.name}
                >
                  {label.name}
                </span>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              className="flex items-center gap-1 px-2 py-1 text-xs text-nim-muted hover:text-nim border border-nim rounded transition-colors"
              onClick={() => window.electronAPI?.openExternal(issueHtmlUrl(issue, remote))}
              title="Open on GitHub"
            >
              <MaterialSymbol icon="open_in_new" size={14} />
              GitHub
            </button>
            <button
              className="flex items-center gap-1 px-2 py-1 text-xs bg-nim-primary text-nim-on-primary hover:bg-nim-primary-hover rounded transition-colors"
              onClick={onStartInvestigationSession}
              data-testid="issue-start-investigation-session"
              title={`Investigate #${issue.number} with AI`}
            >
              <MaterialSymbol icon="chat" size={14} />
              Investigate
            </button>
          </div>
        </div>

        {fetchError && (
          <div className="px-4 pt-2" data-testid="issue-detail-error">
            <PullRequestActionError
              error={`Showing the cached copy of #${listRow.number} — loading it from GitHub failed: ${fetchError}`}
            />
          </div>
        )}

        <div className="flex items-center gap-1 px-3 mt-2">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              data-testid={`issue-tab-${tab.id}`}
              onClick={() => onTabChange(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-[var(--nim-primary)] text-nim'
                  : 'border-transparent text-nim-muted hover:text-nim'
              }`}
            >
              {tab.label}
              {tab.id === 'conversation' && issue.commentsCount > 0 && (
                <span className="ml-1 text-nim-faint">{issue.commentsCount}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {activeTab === 'conversation' && (
          <IssueConversationTab
            workspaceId={workspaceId}
            remote={remote}
            issue={issue}
            refreshToken={refreshToken}
          />
        )}
        {activeTab === 'activity' && (
          <IssueActivityTab
            workspaceId={workspaceId}
            remote={remote}
            issue={issue}
            refreshToken={refreshToken}
          />
        )}
        {activeTab === 'local' && (
          <IssueLocalTab
            workspaceId={workspaceId}
            remote={remote}
            issue={issue}
            context={trackerContext}
            linkedPrNumbers={linkedPrNumbers}
            onWrite={onOverlayWrite}
            onOpenSession={onOpenSession}
          />
        )}
      </div>
    </div>
  );
}
