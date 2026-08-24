/**
 * Issue reference resolution — which tracker items are "about" a GitHub issue.
 *
 * The issue view integration is reference-based, never type-based: no tracker
 * type name (like "github-issue") is privileged. An item of ANY type references
 * a GitHub issue (remote, number) when either:
 *
 *   1. Zero-config URL match — any url-type field value (a string, or a
 *      { url, label } object) matches the issue's canonical GitHub URL.
 *   2. Explicit link — a system.linkedIssues[] entry, written by the issue
 *      view's "Link tracker item" action or agent tooling.
 *
 * Pure functions + derived atoms; no IPC. The atoms derive from the already
 * loaded trackerItemsMapAtom, so resolution is reactive and free of extra
 * round-trips.
 */

import { atom } from 'jotai';
import { atomFamily } from 'jotai-family';
import type { TrackerRecord } from '../../core/TrackerRecord';
import { buildGithubUrl, getRecordGithubReferences, parseGithubUrl } from './githubUrls';
import { trackerItemsMapAtom } from './trackerDataAtoms';

export interface IssueReference {
  /** GitHub remote as "owner/repo" (lowercase). */
  remote: string;
  number: number;
}

/**
 * Parse a GitHub issue URL into a reference, or null when it isn't one.
 * GitHub may redirect /issues/<n> to a pull request, but the URL alone cannot
 * reveal that. Treat the route as an issue reference; upstream metadata must
 * exclude pull requests when actual issue identity matters.
 */
export function parseIssueUrl(url: string): IssueReference | null {
  return parseGithubUrl(url, 'issues');
}

/** Build the canonical GitHub URL for an issue reference. */
export function buildIssueUrl(remote: string, number: number): string {
  return buildGithubUrl(remote, 'issues', number);
}

/**
 * All issue references carried by a tracker record, from both the explicit
 * linkedIssues entries and any field value that looks like an issue URL.
 * Field values may arrive as JSON strings on SQLite — parse defensively.
 */
export function getRecordIssueReferences(record: TrackerRecord): IssueReference[] {
  return getRecordGithubReferences(record, parseIssueUrl, 'linkedIssues');
}

/**
 * Non-archived tracker records referencing each issue number of a remote.
 * Keyed by lowercase "owner/repo". Items in each bucket are sorted most
 * recently updated first, so `[0]` is the primary item for badges.
 */
export const issueTrackerReferencesAtom = atomFamily((remote: string) =>
  atom((get) => {
    const wanted = remote.toLowerCase();
    const byNumber = new Map<number, TrackerRecord[]>();
    for (const record of get(trackerItemsMapAtom).values()) {
      if (record.archived) continue;
      for (const ref of getRecordIssueReferences(record)) {
        if (ref.remote !== wanted) continue;
        const bucket = byNumber.get(ref.number);
        if (bucket) bucket.push(record);
        else byNumber.set(ref.number, [record]);
      }
    }
    for (const bucket of byNumber.values()) {
      bucket.sort((a, b) => (b.system.updatedAt || '').localeCompare(a.system.updatedAt || ''));
    }
    return byNumber;
  })
);
