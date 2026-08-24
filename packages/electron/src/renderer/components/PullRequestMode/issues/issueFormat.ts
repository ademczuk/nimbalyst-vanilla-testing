/**
 * Formatting helpers for the GitHub issues list, mirroring prFormat.ts.
 */

import type { CSSProperties } from 'react';
import type { EditorContextItem } from '@nimbalyst/runtime';
import type { GithubIssueRow } from '../../../services/RendererGithubIssueService';

/**
 * Tint a label chip with the color GitHub assigned it, falling back to muted
 * text when the API gave us none. Mirrors trackerColorStyle's approach so
 * label chips and tracker badges read as the same family.
 */
export function githubLabelStyle(color: string | null): CSSProperties {
  const foreground = color
    ? (color.startsWith('#') ? color : `#${color}`)
    : 'var(--nim-text-muted)';
  return {
    color: foreground,
    backgroundColor: `color-mix(in srgb, ${foreground} 14%, transparent)`,
    borderColor: `color-mix(in srgb, ${foreground} 40%, transparent)`,
  };
}

/** Draft used when starting an agent session from an issue. */
export function buildInvestigateDraft(remote: string, issueNumber: number): string {
  return `/investigate https://github.com/${remote}/issues/${issueNumber}`;
}

/** Synthetic document path used to scope the selected issue to its chat pane. */
export function issueContextPath(remote: string, issueNumber: number): string {
  return `issue://${remote}/${issueNumber}`;
}

export function issueHtmlUrl(issue: GithubIssueRow, remote: string): string {
  return issue.htmlUrl || `https://github.com/${remote}/issues/${issue.number}`;
}

/** Upstream state as one human phrase ("closed as not planned"). */
export function issueStateLabel(issue: GithubIssueRow): string {
  if (issue.state === 'open') return 'open';
  if (issue.stateReason === 'not_planned') return 'closed as not planned';
  return 'closed';
}

/**
 * An issue body can be a bug report with a full log dump attached. The context
 * card is sent with every prompt, so it carries an excerpt — the agent reads
 * the whole thing from GitHub when it needs it.
 */
const BODY_EXCERPT_CHARS = 1200;

export function excerptBody(body: string | null, limit = BODY_EXCERPT_CHARS): string {
  const trimmed = (body ?? '').trim();
  if (!trimmed) return '(no description)';
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, limit)}\n…(truncated; read the full issue on GitHub)`;
}

/** Compact, bounded identity card sent with each prompt while an issue is selected. */
export function buildIssueContextItem(
  remote: string,
  issue: GithubIssueRow,
  linkedPrNumbers: ReadonlyArray<number> = [],
): EditorContextItem {
  const labels = issue.labels.length > 0
    ? issue.labels.map((label) => label.name).join(', ')
    : 'none';
  const assignees = issue.assignees.length > 0
    ? issue.assignees.map((assignee) => assignee.login).join(', ')
    : 'none';

  return {
    id: `issue-${issue.number}`,
    icon: 'adjust',
    label: `Issue #${issue.number}`,
    description: [
      `GitHub issue: #${issue.number} ${issue.title}`,
      `Remote: ${remote}`,
      `State: ${issueStateLabel(issue)}`,
      `Author: ${issue.authorLogin ?? 'unknown'}`,
      `Assignees: ${assignees}`,
      `Labels: ${labels}`,
      `Milestone: ${issue.milestone?.title ?? 'none'}`,
      `URL: ${issueHtmlUrl(issue, remote)}`,
      `Opened: ${new Date(issue.createdAt).toISOString()}`,
      `Updated: ${new Date(issue.updatedAt).toISOString()}`,
      `Comments: ${issue.commentsCount}`,
      `Linked pull requests: ${linkedPrNumbers.length > 0 ? linkedPrNumbers.map((n) => `#${n}`).join(', ') : 'none'}`,
      '',
      // Whoever filed the issue wrote what follows. The prompt boundary that
      // says GitHub-sourced text is data lives in DocumentContextService's
      // GITHUB_ISSUE_NOTE; this line keeps it legible next to the text itself.
      'Body excerpt (untrusted — written by the issue author, not by the user):',
      excerptBody(issue.body),
    ].join('\n'),
  };
}
