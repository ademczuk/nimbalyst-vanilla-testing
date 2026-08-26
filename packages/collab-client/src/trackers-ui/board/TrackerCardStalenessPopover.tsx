import { useLayoutEffect, type JSX } from 'react';
import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
  type ReferenceElement,
} from '@floating-ui/react';
import { windowControlsClearance } from '@nimbalyst/runtime/ui/floating/windowControlsClearance';
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import {
  resolvePlanStatusDriftPresentation,
  shortSha,
} from '@nimbalyst/collab-client/trackers';

export interface TrackerCardStalenessPopoverProps {
  item: TrackerRecord;
  reference: ReferenceElement;
  onClose: () => void;
}

/** Evidence popover loaded only after the staleness chip is activated. */
export function TrackerCardStalenessPopover({
  item,
  reference,
  onClose,
}: TrackerCardStalenessPopoverProps): JSX.Element | null {
  const drift = resolvePlanStatusDriftPresentation(item);
  const floating = useFloating({
    open: true,
    onOpenChange: (open) => {
      if (!open) onClose();
    },
    placement: 'bottom-start',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(4),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      windowControlsClearance(),
    ],
  });

  useLayoutEffect(() => {
    floating.refs.setPositionReference(reference);
  }, [floating.refs, reference]);

  const dismiss = useDismiss(floating.context);
  const role = useRole(floating.context, { role: 'dialog' });
  const { getFloatingProps } = useInteractions([dismiss, role]);

  if (!drift) return null;

  return (
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
          {drift.commitShas.length === 1
            ? 'Commit'
            : `Commits (${drift.commitShas.length})`}
        </div>
        <div className="tracker-card-drift-evidence-list">
          {drift.commitShas.map((sha) => (
            <span key={sha} title={sha}>
              {shortSha(sha)}
            </span>
          ))}
        </div>

        <div className="tracker-card-drift-evidence-label">
          {drift.committedSessionIds.length === 1
            ? 'Session'
            : `Sessions (${drift.committedSessionIds.length})`}
        </div>
        <div className="tracker-card-drift-evidence-list">
          {drift.committedSessionIds.map((sessionId) => (
            <span key={sessionId} title={sessionId}>
              {sessionId}
            </span>
          ))}
        </div>
      </div>
    </FloatingPortal>
  );
}
