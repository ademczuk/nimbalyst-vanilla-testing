/**
 * IssueConversationTab — the issue body plus its comments, rendered live from
 * the cache. Read-only: commenting is a later phase, so there is no composer
 * here even though the service exposes one.
 */

import type { JSX } from 'react';
import { useEffect, useMemo } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import { MarkdownRenderer } from '@nimbalyst/runtime/ui/AgentTranscript/components/MarkdownRenderer';
import {
  githubIssueCommentsAtom,
  githubIssueDetailErrorAtom,
  githubIssueDetailLoadingAtom,
} from '../../../../store/atoms/githubIssues';
import {
  getGithubIssueService,
  type GithubIssueRow,
} from '../../../../services/RendererGithubIssueService';
import { formatRelative } from '../../prFormat';

interface IssueConversationTabProps {
  workspaceId: string;
  remote: string;
  issue: GithubIssueRow;
  /** Bumps to force a reload (detail-level poll). */
  refreshToken: number;
}

export function IssueConversationTab({
  workspaceId,
  remote,
  issue,
  refreshToken,
}: IssueConversationTabProps): JSX.Element {
  const loaded = useAtomValue(githubIssueCommentsAtom);
  const setComments = useSetAtom(githubIssueCommentsAtom);
  const loading = useAtomValue(githubIssueDetailLoadingAtom);
  const setLoading = useSetAtom(githubIssueDetailLoadingAtom);
  const error = useAtomValue(githubIssueDetailErrorAtom);
  const setError = useSetAtom(githubIssueDetailErrorAtom);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getGithubIssueService()
      .comments(workspaceId, remote, issue.number)
      .then((rows) => {
        if (!cancelled) setComments(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setComments([]);
          setError(err instanceof Error ? err.message : 'Failed to load comments');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, remote, issue.number, refreshToken, setComments, setLoading, setError]);

  // The atom is global and still holds the previous selection's comments while
  // this one loads. Each row names the issue it was fetched for, so gate on
  // that rather than letting another issue's discussion render under this
  // issue's body.
  const comments = useMemo(
    () => loaded.filter((comment) => comment.issueId === issue.id),
    [loaded, issue.id],
  );

  return (
    <div
      className="issue-conversation-tab block p-4 space-y-3 overflow-y-auto flex-1 min-h-0"
      data-testid="issue-conversation-tab"
    >
      <div className="border border-nim rounded-md overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 bg-nim-secondary border-b border-nim text-xs text-nim-muted">
          {issue.authorLogin && <span className="font-medium text-nim">{issue.authorLogin}</span>}
          <span>opened this issue</span>
          <span className="ml-auto">{formatRelative(issue.createdAt)}</span>
        </div>
        <div className="px-3 py-2 text-sm text-nim select-text">
          {issue.body?.trim() ? (
            <MarkdownRenderer content={issue.body} />
          ) : (
            <span className="text-nim-faint italic">No description provided.</span>
          )}
        </div>
      </div>

      {error && (
        <div className="text-nim-error text-sm flex items-center gap-2">
          <MaterialSymbol icon="error" size={16} />
          {error}
        </div>
      )}

      {loading && comments.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-6 text-nim-muted text-sm">
          <div className="spinner w-4 h-4 border-[2px] border-nim-secondary border-t-nim-primary rounded-full animate-spin" />
          Loading comments…
        </div>
      ) : (
        comments.map((comment) => (
          <div key={comment.id} className="border border-nim rounded-md overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 bg-nim-secondary border-b border-nim text-xs text-nim-muted">
              {comment.authorLogin && (
                <span className="font-medium text-nim">{comment.authorLogin}</span>
              )}
              <span>commented</span>
              {comment.authorAssociation && comment.authorAssociation !== 'NONE' && (
                <span className="text-nim-faint">{comment.authorAssociation.toLowerCase()}</span>
              )}
              <span className="ml-auto">{formatRelative(comment.createdAt)}</span>
            </div>
            {comment.body.trim() && (
              <div className="px-3 py-2 text-sm text-nim select-text">
                <MarkdownRenderer content={comment.body} />
              </div>
            )}
          </div>
        ))
      )}

      {!loading && comments.length === 0 && !error && (
        <div className="text-nim-faint text-sm text-center py-4">No comments yet.</div>
      )}
    </div>
  );
}
