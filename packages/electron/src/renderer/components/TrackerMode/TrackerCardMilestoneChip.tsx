/**
 * The milestone chip on a board card: what it belongs to, and the way to change
 * that without dragging.
 *
 * A pick here is the same conceptual action as a drag, so it resolves through
 * the same writer -- `resolveMilestoneAssignmentWrites`, which calls the board's
 * `resolveBoardColumnWrite`. It REASSIGNS: the card leaves the milestones it was
 * in and lands in exactly the one you picked, while off-axis memberships (a
 * release also stored on `collection`) survive untouched.
 *
 * The chip reads the card's own stored relationship, so a column of fifty cards
 * costs fifty label reads and nothing else; the picker (and the candidate list it
 * needs) is only built while the popover is open.
 */

import React, { useCallback, useState } from 'react';
import { useAtomValue } from 'jotai';
import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  size,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from '@floating-ui/react';
import { windowControlsClearance } from '@nimbalyst/runtime/ui/floating/windowControlsClearance';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import {
  resolveRelationshipLabel,
  type TrackerRelationshipLabelResolver,
  type TrackerRelationshipValue,
} from '@nimbalyst/runtime/plugins/TrackerPlugin/models';
import { trackerRelationshipLabelAtom } from '@nimbalyst/runtime/plugins/TrackerPlugin/trackerDataAtoms';
import { TrackerMilestonePickerPanel } from './TrackerMilestonePicker';
import {
  cardMilestoneValues,
  resolveMilestoneAssignmentWrites,
  type MilestoneAssignTarget,
} from './trackerBulkAssign';
import { saveTrackerFields } from './trackerFieldSave';
import './TrackerBoardCard.css';

interface TrackerCardMilestoneChipProps {
  item: TrackerRecord;
  onOpenItem?: (itemId: string) => void;
}

/** How the chip reads: the milestone, "+N" when several, or the empty invitation. */
function chipLabel(
  values: TrackerRelationshipValue[],
  resolveLabel: TrackerRelationshipLabelResolver,
): string {
  if (values.length === 0) return 'No milestone';
  const first = resolveRelationshipLabel(values[0], resolveLabel);
  return values.length === 1 ? first : `${first} +${values.length - 1}`;
}

export const TrackerCardMilestoneChip: React.FC<TrackerCardMilestoneChipProps> = ({
  item,
  onOpenItem,
}) => {
  const [open, setOpen] = useState(false);
  const relationshipLabel = useAtomValue(trackerRelationshipLabelAtom);
  const values = cardMilestoneValues(item);
  const empty = values.length === 0;
  const label = chipLabel(values, relationshipLabel);

  const floating = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-start',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(4),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      windowControlsClearance(),
      size({
        padding: 8,
        apply({ availableHeight, elements, middlewareData }) {
          const pushed = middlewareData.windowControlsClearance?.pushed ?? 0;
          elements.floating.style.maxHeight = `${Math.max(0, availableHeight - pushed)}px`;
        },
      }),
    ],
  });
  const dismiss = useDismiss(floating.context);
  const role = useRole(floating.context, { role: 'dialog' });
  const { getReferenceProps, getFloatingProps } = useInteractions([dismiss, role]);

  /**
   * One card is a one-card selection: the same resolver the bulk bar and a drag
   * use decides the write, so all three agree on what "put it here" means. No
   * write at all when the card is already in exactly that milestone.
   */
  const handleAssign = useCallback((target: MilestoneAssignTarget) => {
    setOpen(false);
    const [write] = resolveMilestoneAssignmentWrites([item], target);
    if (write) void saveTrackerFields(item, write.updates);
  }, [item]);

  return (
    <>
      <button
        ref={floating.refs.setReference}
        {...getReferenceProps()}
        type="button"
        draggable={false}
        className={`tracker-card-milestone-chip tracker-card-chip ${empty ? 'tracker-card-chip-empty' : ''}`}
        data-testid="tracker-card-milestone-chip"
        data-empty={empty}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={empty ? 'Assign a milestone' : `Milestone: ${label}`}
        title={empty ? 'Assign a milestone' : `Milestone: ${label}`}
        onClick={(event) => {
          // The card behind the chip selects on click and opens on double-click.
          event.stopPropagation();
          setOpen(value => !value);
        }}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <MaterialSymbol icon="flag" size={11} />
        <span className="tracker-card-chip-label">{label}</span>
      </button>

      {open && (
        <FloatingPortal>
          <div
            ref={floating.refs.setFloating}
            style={floating.floatingStyles}
            {...getFloatingProps()}
            className="tracker-card-popover"
            data-testid="tracker-card-milestone-popover"
            onClick={(event) => event.stopPropagation()}
          >
            <TrackerMilestonePickerPanel
              items={[item]}
              onAssign={handleAssign}
              onRequestClose={() => setOpen(false)}
              onOpenItem={onOpenItem}
              testIdBase="tracker-card-milestone"
              footer={empty ? undefined : (
                <button
                  type="button"
                  className="flex items-center gap-1 text-nim-muted hover:text-nim cursor-pointer"
                  data-testid="tracker-card-milestone-clear"
                  onClick={() => handleAssign({ itemId: null })}
                >
                  <MaterialSymbol icon="remove" size={14} />
                  Remove from milestone
                </button>
              )}
            />
          </div>
        </FloatingPortal>
      )}
    </>
  );
};
