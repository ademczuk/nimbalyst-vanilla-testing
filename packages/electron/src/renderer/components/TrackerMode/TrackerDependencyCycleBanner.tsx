/**
 * TrackerDependencyCycleBanner
 *
 * A dependency cycle is a silent deadlock: every item in it is waiting on
 * another item in it, so none of them will ever appear in the ready queue and
 * nothing on screen says why. The banner is the "why" -- it names the count and
 * lists the members so the user can open one and remove a link.
 *
 * Dismissal is keyed on the membership of the cycles, not on a flag, so closing
 * it silences *this* deadlock while a newly-formed one still surfaces.
 */

import React, { useMemo, useState } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import { getRecordTitle } from '@nimbalyst/runtime/plugins/TrackerPlugin/trackerRecordAccessors';
import { isLocalKeyReference, resolveDisplayIssueKey } from '@nimbalyst/runtime/plugins/TrackerPlugin/models/localIssueKey';
import {
  TRACKER_DEPENDENCY_CYCLE_MESSAGE,
  TRACKER_LOCAL_ISSUE_KEY_BRIEF_MESSAGE,
} from '@nimbalyst/runtime/plugins/TrackerPlugin/models/trackerLifecycle';

interface TrackerDependencyCycleBannerProps {
  /** Every open item the readiness model flagged as part of a cycle. */
  items: TrackerRecord[];
  onOpenItem: (itemId: string) => void;
}

export const TrackerDependencyCycleBanner: React.FC<TrackerDependencyCycleBannerProps> = ({
  items,
  onOpenItem,
}) => {
  const signature = useMemo(
    () => items.map((item) => item.id).sort().join('|'),
    [items],
  );
  const [dismissedSignature, setDismissedSignature] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  // The listed refs are the only thing here anyone would copy out, and a dotted
  // one means nothing on someone else's machine. Once, under the list -- a
  // per-row marker on a deadlock that already has to be read as a set would
  // bury the members it is meant to name.
  const hasLocalRef = useMemo(
    () => items.some((item) => isLocalKeyReference(resolveDisplayIssueKey(item))),
    [items],
  );

  if (items.length === 0 || dismissedSignature === signature) return null;

  return (
    <div
      className="tracker-dependency-cycle-banner flex flex-col gap-1.5 px-3 py-2 border-b border-nim bg-nim-tertiary text-xs text-nim shrink-0"
      role="status"
      data-testid="tracker-dependency-cycle-banner"
      data-cycle-item-count={items.length}
    >
      <div className="flex items-center gap-2">
        <MaterialSymbol icon="sync_problem" size={16} className="text-nim-warning" />
        <span className="flex-1">
          {items.length} {items.length === 1 ? 'item is' : 'items are'} in a dependency cycle.
          {' '}{TRACKER_DEPENDENCY_CYCLE_MESSAGE}
        </span>
        <button
          type="button"
          className="px-2 py-0.5 rounded border border-nim text-nim-muted hover:bg-nim hover:text-nim transition-colors"
          onClick={() => setExpanded((current) => !current)}
          data-testid="tracker-dependency-cycle-toggle"
        >
          {expanded ? 'Hide items' : 'Show items'}
        </button>
        <button
          type="button"
          className="text-nim-faint hover:text-nim p-0.5"
          onClick={() => setDismissedSignature(signature)}
          aria-label="Dismiss"
          data-testid="tracker-dependency-cycle-dismiss"
        >
          <MaterialSymbol icon="close" size={14} />
        </button>
      </div>
      {expanded && (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0 pl-6 select-text">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="flex w-full items-baseline gap-2 rounded px-1 py-0.5 text-left hover:bg-nim"
                onClick={() => onOpenItem(item.id)}
                data-testid="tracker-dependency-cycle-item"
              >
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-nim-faint">
                  {resolveDisplayIssueKey(item) ?? ''}
                </span>
                <span className="min-w-0 flex-1 truncate">{getRecordTitle(item)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {expanded && hasLocalRef && (
        <p className="m-0 pl-6 text-nim-faint" data-testid="tracker-dependency-cycle-local-ref-note">
          {TRACKER_LOCAL_ISSUE_KEY_BRIEF_MESSAGE}
        </p>
      )}
    </div>
  );
};
