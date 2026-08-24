import { atom } from 'jotai';
import type {
  GithubIssueCommentRow,
  GithubIssueEventRow,
  GithubIssueRow,
} from '../../services/RendererGithubIssueService';

export const githubIssueListAtom = atom<GithubIssueRow[]>([]);
export const githubIssueListLoadingAtom = atom(false);
export const githubIssueListErrorAtom = atom<string | null>(null);

export const githubIssueDetailAtom = atom<GithubIssueRow | null>(null);
export const githubIssueCommentsAtom = atom<GithubIssueCommentRow[]>([]);
export const githubIssueTimelineAtom = atom<GithubIssueEventRow[]>([]);
export const githubIssueDetailLoadingAtom = atom(false);
export const githubIssueDetailErrorAtom = atom<string | null>(null);

export interface GithubIssueListUpdated {
  version: number;
  payload: { workspacePath: string; remote: string };
}

/** Debounced request atom; consumers skip its initial null value and re-read the cache. */
export const githubIssueListUpdatedAtom = atom<GithubIssueListUpdated | null>(null);
