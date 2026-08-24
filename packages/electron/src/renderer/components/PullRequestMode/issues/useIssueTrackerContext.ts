/**
 * Issue ↔ tracker ↔ session resolution for the issues list.
 *
 * Reference-based like the PR side (see issueReferences.ts): any tracker item
 * carrying this issue's URL counts, no type name is privileged for *reading*.
 * Writing is narrower — only the `github-issue` overlay is written to (see
 * issueOverlay.ts) — so the context exposes both the full reference list and
 * the overlay picked out of it.
 */

import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import { issueTrackerReferencesAtom } from '@nimbalyst/runtime/plugins/TrackerPlugin/issueReferences';
import { sessionRegistryAtom, type SessionMeta } from '../../../store/atoms/sessions';
import { resolveLinkedSessions } from '../../../utils/resolveLinkedSessions';
import { findIssueOverlay } from './issueOverlay';

/** Referencing tracker items for every issue number of a remote. */
export function useIssueTrackerReferences(remote: string | null): Map<number, TrackerRecord[]> {
  return useAtomValue(issueTrackerReferencesAtom(remote?.toLowerCase() ?? ''));
}

export interface IssueTrackerContext {
  /** Tracker items referencing this issue, most recently updated first. */
  items: TrackerRecord[];
  /** The `github-issue` overlay, or null while the issue has no local state. */
  overlay: TrackerRecord | null;
  /** Sessions linked to any referencing item, newest first. */
  sessions: SessionMeta[];
}

const NO_ITEMS: TrackerRecord[] = [];

export function useIssueTrackerContext(
  remote: string | null,
  issueNumber: number,
  issueUrl: string | null,
): IssueTrackerContext {
  const references = useIssueTrackerReferences(remote);
  const sessionRegistry = useAtomValue(sessionRegistryAtom);

  const items = useMemo(
    () => (issueNumber ? references.get(issueNumber) ?? NO_ITEMS : NO_ITEMS),
    [references, issueNumber],
  );

  const overlay = useMemo(
    () => (issueUrl ? findIssueOverlay(items, issueUrl) : null),
    [items, issueUrl],
  );

  const sessions = useMemo(() => {
    const byId = new Map<string, SessionMeta>();
    for (const item of items) {
      for (const session of resolveLinkedSessions(item, sessionRegistry)) {
        byId.set(session.id, session);
      }
    }
    return Array.from(byId.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }, [items, sessionRegistry]);

  return { items, overlay, sessions };
}
