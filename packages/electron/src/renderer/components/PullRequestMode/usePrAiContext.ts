import { useMemo } from 'react';
import type { PullRequestRow } from '../../services/RendererPullRequestService';
import { buildPrContextItem, prContextPath } from './prFormat';
import {
  useGithubPanelAiContext,
  type GithubPanelAiContext,
} from './useGithubPanelAiContext';

export type PrAiContext = GithubPanelAiContext;

/**
 * Publish the visible PR through the editor-context store using a synthetic
 * path, keeping the chat chip scoped to PR mode and clearing it while hidden.
 */
export function usePrAiContext(
  remote: string | null,
  selectedPr: PullRequestRow | null,
  isActive: boolean,
): PrAiContext {
  const path = isActive && remote && selectedPr
    ? prContextPath(remote, selectedPr.number)
    : '';
  const item = useMemo(
    () => remote && selectedPr ? buildPrContextItem(remote, selectedPr) : null,
    [remote, selectedPr],
  );

  return useGithubPanelAiContext(path, item, 'pull-request');
}
