/**
 * PR reference resolution — which tracker items are "about" a pull request.
 *
 * The PR view integration is reference-based, never type-based: no tracker
 * type name (like "github-pr") is privileged. An item of ANY type references
 * PR (remote, number) when either:
 *
 *   1. Zero-config URL match — any url-type field value (a string, or a
 *      { url, label } object) matches the PR's canonical GitHub URL.
 *   2. Explicit link — a system.linkedPullRequests[] entry, written by the
 *      PR view's "Link tracker item" action or agent tooling.
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

export interface PrReference {
  /** GitHub remote as "owner/repo" (lowercase). */
  remote: string;
  number: number;
}

/** Parse a GitHub PR URL into a reference, or null when it isn't one. */
export function parsePrUrl(url: string): PrReference | null {
  return parseGithubUrl(url, 'pull');
}

/** Build the canonical GitHub URL for a PR reference. */
export function buildPrUrl(remote: string, number: number): string {
  return buildGithubUrl(remote, 'pull', number);
}

/**
 * All PR references carried by a tracker record, from both the explicit
 * linkedPullRequests entries and any field value that looks like a PR URL.
 * Field values may arrive as JSON strings on SQLite — parse defensively.
 */
export function getRecordPrReferences(record: TrackerRecord): PrReference[] {
  return getRecordGithubReferences(record, parsePrUrl, 'linkedPullRequests');
}

/**
 * Non-archived tracker records referencing each PR number of a remote.
 * Keyed by lowercase "owner/repo". Items in each bucket are sorted most
 * recently updated first, so `[0]` is the primary item for badges.
 */
export const prTrackerReferencesAtom = atomFamily((remote: string) =>
  atom((get) => {
    const wanted = remote.toLowerCase();
    const byNumber = new Map<number, TrackerRecord[]>();
    for (const record of get(trackerItemsMapAtom).values()) {
      if (record.archived) continue;
      for (const ref of getRecordPrReferences(record)) {
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
