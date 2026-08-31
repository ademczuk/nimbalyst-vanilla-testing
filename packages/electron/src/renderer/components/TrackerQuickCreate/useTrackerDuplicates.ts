/**
 * Feeds `scoreTrackerDuplicates` from live app state.
 *
 * Arm A's index is derived from the tracker records already in `trackerItemsMapAtom`
 * — every non-archived item in the workspace, loaded once at app mount and kept
 * current by the sync listeners. No separate load, no second copy to go stale.
 *
 * Arm B calls `semanticSearch.query` on a debounce and only when the memory
 * engine is actually running, so the strip is fully functional with the memory
 * extension off (which is the default).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { trackerItemsByTypeAtom } from '@nimbalyst/runtime/plugins/TrackerPlugin/trackerDataAtoms';
import { getRecordStatus, getRecordTitle } from '@nimbalyst/runtime/plugins/TrackerPlugin/trackerRecordAccessors';
import {
  isLocalIssueKey,
  resolveDisplayIssueKey,
} from '@nimbalyst/runtime/plugins/TrackerPlugin/models/localIssueKey';
import {
  scoreTrackerDuplicates,
  type DuplicateIndexEntry,
  type DuplicateMatch,
  type SemanticDuplicateHit,
} from './scoreTrackerDuplicates';

/** How long a title sits still before the (billed) embedding query runs. */
const SEMANTIC_DEBOUNCE_MS = 250;

export function useTrackerDuplicateIndex(): DuplicateIndexEntry[] {
  // 'all' is every non-archived record: a bug is a duplicate of an existing bug
  // whether or not you were about to file it as a task.
  const records = useAtomValue(trackerItemsByTypeAtom('all'));
  return useMemo(
    () =>
      records.map((record): DuplicateIndexEntry => {
        const displayKey = resolveDisplayIssueKey(record);
        return {
          id: record.id,
          title: getRecordTitle(record),
          type: record.primaryType,
          status: getRecordStatus(record) || undefined,
          displayKey,
          keyIsShared: Boolean(record.issueKey && !isLocalIssueKey(record.issueKey)),
          updatedAt: Date.parse(record.system.updatedAt) || undefined,
        };
      }),
    [records],
  );
}

export interface TrackerDuplicatesState {
  matches: DuplicateMatch[];
  /** True when the memory engine is running and Arm B is contributing. */
  semanticAvailable: boolean;
}

export function useTrackerDuplicates(
  workspacePath: string | null,
  title: string,
  enabled: boolean,
): TrackerDuplicatesState {
  const index = useTrackerDuplicateIndex();
  const [semanticAvailable, setSemanticAvailable] = useState(false);
  const [semanticHits, setSemanticHits] = useState<SemanticDuplicateHit[]>([]);
  const latestQueryRef = useRef('');

  useEffect(() => {
    if (!workspacePath || !enabled) return;
    let cancelled = false;
    void window.electronAPI?.semanticSearch
      ?.isAvailable(workspacePath)
      .then((available) => {
        if (!cancelled) setSemanticAvailable(Boolean(available));
      })
      .catch(() => {
        if (!cancelled) setSemanticAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspacePath, enabled]);

  useEffect(() => {
    if (!workspacePath || !enabled || !semanticAvailable) {
      setSemanticHits([]);
      return;
    }
    const query = title.trim();
    latestQueryRef.current = query;
    if (query.length < 12) {
      setSemanticHits([]);
      return;
    }

    const timer = setTimeout(() => {
      void window.electronAPI.semanticSearch
        .query(workspacePath, query, 8, ['trackers'])
        .then((results) => {
          // A slower earlier query must not overwrite a newer title's hits.
          if (latestQueryRef.current !== query) return;
          setSemanticHits(
            results.map((result) => ({ refId: result.refId, cosine: result.similarity?.cosine })),
          );
        })
        .catch(() => {
          if (latestQueryRef.current === query) setSemanticHits([]);
        });
    }, SEMANTIC_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [workspacePath, enabled, semanticAvailable, title]);

  const matches = useMemo(
    () => (enabled ? scoreTrackerDuplicates(index, title, semanticHits) : []),
    [enabled, index, title, semanticHits],
  );

  return { matches, semanticAvailable };
}
