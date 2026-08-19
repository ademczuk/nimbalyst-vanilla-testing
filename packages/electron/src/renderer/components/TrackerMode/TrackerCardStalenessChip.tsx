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

import React, { useState } from 'react';
import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from '@floating-ui/react';
import { windowControlsClearance } from '@nimbalyst/runtime/ui/floating/windowControlsClearance';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import { resolvePlanStatusDriftPresentation, shortSha } from './trackerCardStaleness';
import './TrackerBoardCard.css';

interface TrackerCardStalenessChipProps {
  item: TrackerRecord;
}

export const TrackerCardStalenessChip: React.FC<TrackerCardStalenessChipProps> = ({ item }) => {
  const [open, setOpen] = useState(false);
  const drift = resolvePlanStatusDriftPresentation(item);

  const floating = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-start',
    whileElementsMounted: autoUpdate,
    middleware: [offset(4), flip({ padding: 8 }), shift({ padding: 8 }), windowControlsClearance()],
  });
  const dismiss = useDismiss(floating.context);
  const role = useRole(floating.context, { role: 'dialog' });
  const { getReferenceProps, getFloatingProps } = useInteractions([dismiss, role]);

  if (!drift) return null;

  return (
    <>
      <button
        ref={floating.refs.setReference}
        {...getReferenceProps()}
        type="button"
        draggable={false}
        className="tracker-card-staleness-chip tracker-card-chip tracker-card-chip-drift"
        data-testid="tracker-card-staleness-chip"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={drift.headline}
        title={drift.headline}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(value => !value);
        }}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <MaterialSymbol icon="help" size={11} />
        <span className="tracker-card-chip-label">{drift.chipLabel}</span>
      </button>

      {open && (
        <FloatingPortal>
          <div
            ref={floating.refs.setFloating}
            style={floating.floatingStyles}
            {...getFloatingProps()}
            className="tracker-card-popover tracker-card-staleness-popover"
            data-testid="tracker-card-staleness-popover"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="tracker-card-drift-headline">{drift.headline}</div>
            <div className="tracker-card-drift-note">
              Nothing has been changed. Read the commits and decide for yourself --
              a linked session committing is not proof that this plan shipped.
            </div>

            <div className="tracker-card-drift-evidence-label">
              {drift.commitShas.length === 1 ? 'Commit' : `Commits (${drift.commitShas.length})`}
            </div>
            <div className="tracker-card-drift-evidence-list">
              {drift.commitShas.map(sha => (
                <span key={sha} title={sha}>{shortSha(sha)}</span>
              ))}
            </div>

            <div className="tracker-card-drift-evidence-label">
              {drift.committedSessionIds.length === 1
                ? 'Session'
                : `Sessions (${drift.committedSessionIds.length})`}
            </div>
            <div className="tracker-card-drift-evidence-list">
              {drift.committedSessionIds.map(sessionId => (
                <span key={sessionId} title={sessionId}>{sessionId}</span>
              ))}
            </div>
          </div>
        </FloatingPortal>
      )}
    </>
  );
};
