/**
 * One-time summary of what the sharing-model upgrade did to this workspace's
 * trackers (PRD D6). Calm and factual: nothing went wrong, but a tracker that
 * changed hands should be discoverable rather than mysterious.
 *
 * Shown at most once per migration — dismissing records the timestamp in
 * workspace state — and never at all when nothing actually moved.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import { globalRegistry } from '@nimbalyst/runtime/plugins/TrackerPlugin/models/TrackerDataModel';
import { TrackerOwnershipChip } from '../common/TrackerOwnershipChip';
import {
  describeTrackerSharingOutcome,
  selectTrackerSharingMigrationNotice,
  type TrackerSharingMigrationNotice as Notice,
} from './trackerSharingMigrationNotice';

export const TrackerSharingMigrationBanner: React.FC<{
  workspacePath?: string;
  teamName?: string | null;
}> = ({ workspacePath, teamName }) => {
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    if (!workspacePath) {
      setNotice(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const state = await (window as any).electronAPI.invoke('workspace:get-state', workspacePath);
        if (cancelled) return;
        setNotice(selectTrackerSharingMigrationNotice(
          state?.trackerSharingMigration,
          state?.trackerSharingMigrationSeenAt,
        ));
      } catch {
        if (!cancelled) setNotice(null);
      }
    })();
    return () => { cancelled = true; };
  }, [workspacePath]);

  const handleDismiss = useCallback(() => {
    const acknowledged = notice;
    setNotice(null);
    if (!workspacePath || !acknowledged) return;
    void (window as any).electronAPI.invoke('workspace:update-state', workspacePath, {
      trackerSharingMigrationSeenAt: acknowledged.migratedAt,
    }).catch((error: unknown) => {
      console.error('[TrackerSharingMigrationNotice] Failed to record acknowledgement:', error);
    });
  }, [notice, workspacePath]);

  if (!notice) return null;

  return (
    <div
      className="tracker-sharing-migration-banner flex items-start gap-2.5 px-3 py-2.5 border-b border-nim bg-nim-tertiary text-xs text-nim shrink-0"
      role="status"
      data-testid="tracker-sharing-migration-banner"
    >
      <MaterialSymbol icon="info" size={15} className="shrink-0 mt-0.5 text-nim-muted" />
      <div className="flex-1 min-w-0">
        <div className="font-medium">Sharing now belongs to the tracker itself</div>
        <p className="mt-0.5 text-nim-muted leading-relaxed">
          Each tracker is personal or your team's, covering its fields and its items together.
          Where this machine's old per-tracker setting disagreed with the schema file, the
          setting you were actually using won:
        </p>
        <ul className="mt-1.5 space-y-1">
          {notice.changes.map((change) => (
            <li key={change.trackerType} className="flex items-center gap-1.5 flex-wrap">
              <span className="font-medium">
                {globalRegistry.get(change.trackerType)?.displayNamePlural ?? change.trackerType}
              </span>
              <span className="text-nim-muted">{describeTrackerSharingOutcome(change)}</span>
              <TrackerOwnershipChip
                ownership={change.sharing}
                teamName={teamName}
                draftByDefault={change.draftByDefault}
              />
            </li>
          ))}
        </ul>
      </div>
      <button
        className="shrink-0 px-2 py-1 rounded border border-nim text-nim-muted hover:text-nim hover:bg-nim-tertiary"
        onClick={handleDismiss}
        data-testid="tracker-sharing-migration-dismiss"
      >
        Got it
      </button>
    </div>
  );
};
