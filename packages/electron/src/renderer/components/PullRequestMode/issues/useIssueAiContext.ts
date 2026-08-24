import { useMemo } from 'react';
import type { GithubIssueRow } from '../../../services/RendererGithubIssueService';
import {
  useGithubPanelAiContext,
  type GithubPanelAiContext,
} from '../useGithubPanelAiContext';
import { buildIssueContextItem, issueContextPath } from './issueFormat';

const EMPTY_LINKED_PRS: ReadonlyArray<number> = [];

/**
 * Publish the visible issue through the editor-context store using a synthetic
 * `issue://<remote>/<number>` path, so the chat chip is scoped to this panel
 * and cleared while it is hidden. Mirrors usePrAiContext.
 */
export function useIssueAiContext(
  remote: string | null,
  selectedIssue: GithubIssueRow | null,
  isActive: boolean,
  /** Must be referentially stable — a new array each render republishes the card. */
  linkedPrNumbers: ReadonlyArray<number> = EMPTY_LINKED_PRS,
): GithubPanelAiContext {
  const path = isActive && remote && selectedIssue
    ? issueContextPath(remote, selectedIssue.number)
    : '';
  const item = useMemo(
    () => (remote && selectedIssue
      ? buildIssueContextItem(remote, selectedIssue, linkedPrNumbers)
      : null),
    [remote, selectedIssue, linkedPrNumbers],
  );

  return useGithubPanelAiContext(path, item, 'github-issue');
}
