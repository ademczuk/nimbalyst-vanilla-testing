/**
 * Desktop binding for the shared tracker comment thread.
 *
 * The thread itself lives in `@nimbalyst/collab-client/trackers-ui` so the
 * browser console renders the same one. Everything desktop-shaped -- the IPC
 * mutation channels and the identity lookup -- stays here.
 */

import React, { useCallback, useEffect, useState } from 'react';
import type { TrackerIdentity } from '@nimbalyst/runtime';
import type { TrackerCommentEntry } from '@nimbalyst/runtime/sync/trackerProtocol';
import {
  TrackerCommentsSection as SharedTrackerCommentsSection,
  type TrackerCommentMutation,
} from '@nimbalyst/collab-client/trackers-ui';
import { getRelativeTimeString } from '../../utils/dateFormatting';
import { invokeTrackerCommentMutation } from './trackerCommentMutation';

export interface TrackerCommentsSectionProps {
  itemId: string;
  comments?: TrackerCommentEntry[];
}

export const TrackerCommentsSection: React.FC<TrackerCommentsSectionProps> = ({ itemId, comments }) => {
  const [identity, setIdentity] = useState<TrackerIdentity | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI
      .invoke('document-service:get-current-identity')
      .then((result: any) => {
        if (cancelled) return;
        if (result?.success && result.identity) setIdentity(result.identity);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const mutate = useCallback(async (mutation: TrackerCommentMutation) => {
    const invoke = window.electronAPI.invoke;
    if (mutation.kind === 'add') {
      return invokeTrackerCommentMutation(invoke, 'document-service:tracker-item-add-comment', {
        itemId,
        body: mutation.body,
      });
    }
    return invokeTrackerCommentMutation(invoke, 'document-service:tracker-item-update-comment', {
      itemId,
      commentId: mutation.commentId,
      ...(mutation.kind === 'update' ? { body: mutation.body } : { deleted: true }),
    });
  }, [itemId]);

  return (
    <SharedTrackerCommentsSection
      comments={comments}
      identity={identity}
      mutate={mutate}
      formatTimestamp={getRelativeTimeString}
    />
  );
};
