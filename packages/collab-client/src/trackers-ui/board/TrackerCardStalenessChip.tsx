/**
 * The staleness chip on a board card.
 *
 * It flags one disagreement -- a plan still marked draft or ready-for-development
 * whose linked session has committed -- and it never writes. The popover shows the
 * commits and sessions the signal was built from, because the heuristic is
 * genuinely fallible: the audit that motivated this feature listed four plans as
 * shipped and two of the four did not hold up once the commits were read. So the
 * chip asks a question and hands over the evidence rather than announcing a
 * verdict the reader cannot check.
 */

import React, { lazy, Suspense, useState } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import { resolvePlanStatusDriftPresentation } from '@nimbalyst/collab-client/trackers';
import './TrackerBoardCard.css';

const loadTrackerCardStalenessPopover = () =>
  import('./TrackerCardStalenessPopover');
const TrackerCardStalenessPopover = lazy(() =>
  loadTrackerCardStalenessPopover().then((module) => ({
    default: module.TrackerCardStalenessPopover,
  }))
);

interface TrackerCardStalenessChipProps {
  item: TrackerRecord;
}

export const TrackerCardStalenessChip: React.FC<
  TrackerCardStalenessChipProps
> = ({ item }) => {
  const [open, setOpen] = useState(false);
  const [reference, setReference] = useState<HTMLButtonElement | null>(null);
  const drift = resolvePlanStatusDriftPresentation(item);

  if (!drift) return null;

  return (
    <>
      <button
        ref={setReference}
        type="button"
        draggable={false}
        className="tracker-card-staleness-chip tracker-card-chip tracker-card-chip-drift"
        data-testid="tracker-card-staleness-chip"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={drift.headline}
        title={drift.headline}
        onPointerEnter={() => {
          void loadTrackerCardStalenessPopover();
        }}
        onFocus={() => {
          void loadTrackerCardStalenessPopover();
        }}
        onPointerDown={() => {
          void loadTrackerCardStalenessPopover();
        }}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <MaterialSymbol icon="help" size={11} />
        <span className="tracker-card-chip-label">{drift.chipLabel}</span>
      </button>

      {open && reference && (
        <Suspense fallback={null}>
          <TrackerCardStalenessPopover
            item={item}
            reference={reference}
            onClose={() => setOpen(false)}
          />
        </Suspense>
      )}
    </>
  );
};
