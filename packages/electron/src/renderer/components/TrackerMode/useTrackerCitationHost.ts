/**
 * Desktop host for the citation inspector (knowledge-scopes contract 4.4, N7).
 *
 * Two halves, from two different places on purpose:
 *
 * - `lookupItem` reads the already-loaded tracker records, so opening an
 *   inspector costs no IO. Everything it returns is the item AS IT IS NOW --
 *   the citation's own record, its capture, its source. That is correct for
 *   those three, which are append-only by construction.
 * - `readRevision` goes to the revision log through the bound data source,
 *   because the one thing that must NOT come from the live record is the
 *   revision a citation pins. The data source rejects a missing revision; this
 *   layer adds no fallback, and neither may any caller.
 */

import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { trackerItemsMapAtom } from '@nimbalyst/runtime/plugins/TrackerPlugin/trackerDataAtoms';
import { getRecordTitle } from '@nimbalyst/runtime/plugins/TrackerPlugin/trackerRecordAccessors';
import type {
  CitationInspectorHost,
  CitationInspectorItem,
} from '@nimbalyst/runtime/plugins/TrackerPlugin/components/CitationInspector';
import { trackerRevisionReaderAtom } from '../../store/atoms/trackers';

export function useTrackerCitationHost(): CitationInspectorHost {
  const itemsMap = useAtomValue(trackerItemsMapAtom);
  const readRevision = useAtomValue(trackerRevisionReaderAtom);

  return useMemo<CitationInspectorHost>(() => ({
    lookupItem(itemId: string): CitationInspectorItem | null {
      const record = itemsMap.get(itemId);
      if (!record) return null;
      return {
        itemId: record.id,
        type: record.primaryType,
        issueKey: record.issueKey || undefined,
        title: getRecordTitle(record) || undefined,
        fields: record.fields,
      };
    },
    ...(readRevision
      ? {
        readRevision: async (itemId: string, ref: { revisionId?: string; serverRevision?: number }) => {
          const revision = await readRevision(itemId, ref);
          return {
            revisionId: revision.revisionId,
            serverRevision: revision.serverRevision,
            deletedAt: revision.deletedAt,
            recordedAt: revision.recordedAt,
            data: revision.data,
          };
        },
      }
      : {}),
  }), [itemsMap, readRevision]);
}
