/**
 * The board's selection bar -- the visible way in and out of multi-select.
 *
 * It appears the moment a card is checked (or cmd/shift-clicked) and disappears
 * when the selection is cleared, so multi-select is a state you can see rather
 * than a mode you have to remember you are in. Escape and "Clear" both leave it.
 * Deliberately local to the board: no toggle anywhere else in the app.
 *
 * "Assign to milestone" is the affordance that makes fifty unplaced plans
 * tractable. It opens the shared milestone picker, resolves one write per card
 * through the same rule a drag uses, and sends them as a single batch.
 */

import React, { useCallback, useState } from 'react';
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
import { TrackerMilestonePickerPanel } from './TrackerMilestonePicker';
import {
  resolveMilestoneAssignmentWrites,
  type MilestoneAssignTarget,
} from './trackerBulkAssign';
import { saveTrackerFieldsBatch } from './trackerFieldSave';
import './TrackerBoardCard.css';

interface KanbanBoardSelectionBarProps {
  /** The selected records, in board order. */
  items: readonly TrackerRecord[];
  onClearSelection: () => void;
}

export const KanbanBoardSelectionBar: React.FC<KanbanBoardSelectionBarProps> = ({
  items,
  onClearSelection,
}) => {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);

  const floating = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'top-start',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(6),
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

  const assign = useCallback(async (target: MilestoneAssignTarget) => {
    const writes = resolveMilestoneAssignmentWrites(items, target);
    setOpen(false);
    if (writes.length === 0) {
      setStatus('Already there');
      return;
    }
    setAssigning(true);
    const result = await saveTrackerFieldsBatch(writes);
    setAssigning(false);
    setStatus(result.failed > 0
      ? `${result.written} moved, ${result.failed} failed`
      : `${result.written} moved`);
  }, [items]);

  const count = items.length;

  return (
    <div
      className="tracker-board-selection-bar"
      data-testid="tracker-board-selection-bar"
      data-component="KanbanBoardSelectionBar"
    >
      <span className="tracker-board-selection-bar-count">
        {count} selected
      </span>
      <span className="tracker-board-selection-bar-hint">
        Shift-click for a range
      </span>

      <button
        ref={floating.refs.setReference}
        {...getReferenceProps()}
        type="button"
        className="flex items-center gap-1 px-2 py-1 rounded border border-nim text-nim hover:bg-nim-hover cursor-pointer ml-auto"
        data-testid="tracker-board-bulk-milestone-button"
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={assigning}
        onClick={() => { setStatus(null); setOpen(value => !value); }}
      >
        <MaterialSymbol icon="flag" size={14} />
        {assigning ? 'Assigning…' : 'Assign to milestone'}
      </button>

      {status && (
        <span className="tracker-board-selection-bar-status" data-testid="tracker-board-selection-bar-status">
          {status}
        </span>
      )}

      <button
        type="button"
        className="flex items-center gap-1 px-2 py-1 rounded border border-nim text-nim-muted hover:bg-nim-hover hover:text-nim cursor-pointer"
        data-testid="tracker-board-clear-selection"
        onClick={onClearSelection}
      >
        <MaterialSymbol icon="close" size={14} />
        Clear
      </button>

      {open && (
        <FloatingPortal>
          <div
            ref={floating.refs.setFloating}
            style={floating.floatingStyles}
            {...getFloatingProps()}
            className="tracker-card-popover"
            data-testid="tracker-board-bulk-milestone-popover"
          >
            <TrackerMilestonePickerPanel
              items={items}
              heading={`Assign ${count} item${count > 1 ? 's' : ''} to`}
              onAssign={target => void assign(target)}
              onRequestClose={() => setOpen(false)}
              testIdBase="tracker-board-bulk-milestone"
              footer={(
                <button
                  type="button"
                  className="flex items-center gap-1 text-nim-muted hover:text-nim cursor-pointer"
                  data-testid="tracker-board-bulk-milestone-clear"
                  onClick={() => void assign({ itemId: null })}
                >
                  <MaterialSymbol icon="remove" size={14} />
                  Remove from milestone
                </button>
              )}
            />
          </div>
        </FloatingPortal>
      )}
    </div>
  );
};
