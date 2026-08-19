/**
 * The milestone picker the board's card chip and bulk bar both open.
 *
 * This is an ASSIGNMENT surface, not a membership editor, and that is why it is
 * not the shared `CollectionPickerPopover`. That picker toggles membership on a
 * multi-value collection field: clicking a value the item already has removes
 * it, and clicking a new one adds it alongside. Both are wrong here.
 *
 *  - A board drag reassigns -- a card sits in exactly the lane you dropped it
 *    in -- and the chip is the same gesture without the dragging, so a pick has
 *    to reassign too. Picking a value is therefore never a toggle; it names a
 *    target, and `resolveMilestoneAssignmentWrites` (which calls the board's own
 *    `resolveBoardColumnWrite`) decides what that means for each card. Clearing
 *    is a separate, explicit action in the footer.
 *  - The `collection` field targets milestones AND releases, so the generic
 *    picker offers releases here as though they were milestones. A release
 *    picked as a milestone is invisible to the milestone chip and, in bulk,
 *    stamps `trackerType: 'milestone'` onto a release id. Candidates and
 *    creation are both milestone-only.
 *
 * The generic collection picker still owns the surfaces that genuinely edit both
 * collection types (the detail panel's Collection chip).
 *
 * Candidates are computed here rather than per card, so mounting fifty cards
 * does not build fifty candidate lists -- the panel only exists while a popover
 * is open.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import { trackerItemsMapAtom } from '@nimbalyst/runtime/plugins/TrackerPlugin/trackerDataAtoms';
import { getRecordTitle } from '@nimbalyst/runtime/plugins/TrackerPlugin/trackerRecordAccessors';
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import {
  resolveGroupingRelationshipField,
  type FieldDefinition,
} from '@nimbalyst/runtime/plugins/TrackerPlugin/models';
import { createCollectionItem } from './createCollectionItem';
import { milestoneMembershipCounts, type MilestoneAssignTarget } from './trackerBulkAssign';

/**
 * The only collection type this picker deals in.
 *
 * It must stay the `milestone` grouping axis's own type: the read side
 * (`resolveGroupingRelationshipValues`) keeps a stored value only when its
 * `trackerType` is the axis, so anything else offered here would be assigned
 * and then never seen again.
 */
const MILESTONE_TRACKER_TYPE = 'milestone';

/**
 * The collection field a selection writes its milestone through.
 *
 * A mixed selection resolves against the first item that declares one; every
 * item's own field is resolved again at write time, so a selection spanning
 * types with differently-named fields still writes each item correctly. A field
 * that cannot target milestones at all is no use to this picker -- offering one
 * would write a relationship its own schema rejects.
 */
function resolveSelectionCollectionField(
  items: readonly TrackerRecord[],
): FieldDefinition | undefined {
  for (const item of items) {
    const field = resolveGroupingRelationshipField(item.primaryType, 'milestone');
    const targets = field?.targetTrackerTypes;
    if (field && (!targets || targets === '*' || targets.includes(MILESTONE_TRACKER_TYPE))) {
      return field;
    }
  }
  return undefined;
}

/** How many of the picked-over items are in a milestone: none, some, or all. */
type AssignmentState = 'none' | 'some' | 'all';

interface MilestoneOption {
  itemId: string;
  title?: string;
  issueKey?: string;
  label: string;
  state: AssignmentState;
  /** Selected items already in this milestone; only meaningful when `some`. */
  assignedCount: number;
}

export interface TrackerMilestonePickerPanelProps {
  /** Items the pick applies to. Non-empty. */
  items: readonly TrackerRecord[];
  /** Place every item in `target`, or take them all out when `itemId` is null. */
  onAssign: (target: MilestoneAssignTarget) => void;
  onRequestClose: () => void;
  onOpenItem?: (itemId: string) => void;
  /** Extra actions under the list (both callers put "Remove from milestone" here). */
  footer?: React.ReactNode;
  heading?: string;
  testIdBase: string;
}

function matchesQuery(option: MilestoneOption, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return option.label.toLowerCase().includes(q)
    || (option.issueKey?.toLowerCase().includes(q) ?? false);
}

export const TrackerMilestonePickerPanel: React.FC<TrackerMilestonePickerPanelProps> = ({
  items,
  onAssign,
  onRequestClose,
  onOpenItem,
  footer,
  heading,
  testIdBase,
}) => {
  const itemsMap = useAtomValue(trackerItemsMapAtom);
  const field = useMemo(() => resolveSelectionCollectionField(items), [items]);
  const selectedIds = useMemo(() => new Set(items.map(item => item.id)), [items]);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const options = useMemo<MilestoneOption[]>(() => {
    const counts = milestoneMembershipCounts(items);
    const values: MilestoneOption[] = [];
    for (const record of itemsMap.values()) {
      if (record.primaryType !== MILESTONE_TRACKER_TYPE) continue;
      // A milestone in the selection is never its own milestone.
      if (selectedIds.has(record.id)) continue;
      const assignedCount = counts.get(record.id) ?? 0;
      const title = getRecordTitle(record) || undefined;
      values.push({
        itemId: record.id,
        title,
        issueKey: record.issueKey || undefined,
        label: title || record.issueKey || record.id,
        state: assignedCount === 0 ? 'none' : assignedCount === items.length ? 'all' : 'some',
        assignedCount,
      });
    }
    // Milestones the selection already touches sort first, so "where are these
    // now" stays visible while the list narrows.
    return values.sort((a, b) => {
      const rank = (option: MilestoneOption) => (option.state === 'none' ? 1 : 0);
      return rank(a) - rank(b) || a.label.localeCompare(b.label);
    });
  }, [items, itemsMap, selectedIds]);

  const trimmedQuery = query.trim();
  const results = useMemo(
    () => options.filter(option => matchesQuery(option, trimmedQuery)),
    [options, trimmedQuery],
  );

  // Creating is offered only for a genuinely new name: an exact match means the
  // user is looking at the milestone they meant, not missing one.
  const canCreate = trimmedQuery.length > 0 && !options.some(option =>
    option.label.toLowerCase() === trimmedQuery.toLowerCase()
    || option.issueKey?.toLowerCase() === trimmedQuery.toLowerCase());
  const createRowIndex = canCreate ? results.length : -1;
  const rowCount = results.length + (canCreate ? 1 : 0);

  useEffect(() => {
    setActiveIndex(index => (index < rowCount ? index : Math.max(0, rowCount - 1)));
  }, [rowCount]);

  /** Every candidate click means the same thing: put these items in there. */
  const assignTo = useCallback((option: MilestoneOption) => {
    onAssign({ itemId: option.itemId, title: option.title, issueKey: option.issueKey });
  }, [onAssign]);

  const createAndAssign = useCallback(async () => {
    const workspacePath = items[0]?.system.workspace;
    if (!workspacePath || !trimmedQuery || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const created = await createCollectionItem({
        workspacePath,
        type: MILESTONE_TRACKER_TYPE,
        title: trimmedQuery,
      });
      if (!created) {
        setCreateError('Could not create the milestone.');
        return;
      }
      onAssign({ itemId: created.itemId, title: created.title, issueKey: created.issueKey });
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : String(error));
    } finally {
      setCreating(false);
    }
  }, [creating, items, onAssign, trimmedQuery]);

  const activateRow = useCallback((index: number) => {
    if (index === createRowIndex) {
      void createAndAssign();
      return;
    }
    const option = results[index];
    if (option) assignTo(option);
  }, [assignTo, createAndAssign, createRowIndex, results]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (rowCount > 0) setActiveIndex(index => (index + 1) % rowCount);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (rowCount > 0) setActiveIndex(index => (index - 1 + rowCount) % rowCount);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      activateRow(activeIndex);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onRequestClose();
    }
  }, [activateRow, activeIndex, onRequestClose, rowCount]);

  if (!field) {
    return (
      <div className="tracker-milestone-picker-unavailable" data-testid={`${testIdBase}-unavailable`}>
        This item type has no milestone field.
      </div>
    );
  }

  return (
    <div className="tracker-milestone-picker" data-testid={testIdBase}>
      {heading && <div className="tracker-milestone-picker-heading">{heading}</div>}

      <input
        ref={inputRef}
        type="text"
        className="tracker-milestone-picker-search"
        placeholder="Search milestones…"
        aria-label="Search milestones"
        value={query}
        disabled={creating}
        onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
        onKeyDown={handleKeyDown}
        data-testid={`${testIdBase}-search`}
      />

      <div
        className="tracker-milestone-picker-list"
        role="listbox"
        aria-label="Milestones"
        data-testid={`${testIdBase}-list`}
      >
        {results.length === 0 && !canCreate && (
          <div className="tracker-milestone-picker-empty" data-testid={`${testIdBase}-empty`}>
            {options.length === 0 ? 'No milestones yet' : 'No matches'}
          </div>
        )}

        {results.map((option, index) => (
          <div className="tracker-milestone-picker-row" role="presentation" key={option.itemId}>
            <button
              type="button"
              role="option"
              aria-selected={option.state === 'all'}
              data-active={index === activeIndex}
              data-assignment={option.state}
              className={index === activeIndex
                ? 'tracker-milestone-picker-option tracker-milestone-picker-option-active'
                : 'tracker-milestone-picker-option'}
              aria-label={option.state === 'some'
                ? `${option.label} — ${option.assignedCount} of ${items.length} selected; assign all`
                : option.label}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => assignTo(option)}
              data-testid={`${testIdBase}-option-${option.itemId}`}
            >
              <MaterialSymbol icon="flag" size={15} className="tracker-milestone-picker-option-icon" />
              <span className="tracker-milestone-picker-option-label">{option.label}</span>
              {/* A partly-applied milestone is a third state, not a checked one:
                  it says where the selection is, and clicking still assigns. */}
              {option.state === 'some' && (
                <span className="tracker-milestone-picker-option-partial">
                  {option.assignedCount}/{items.length}
                </span>
              )}
              {option.state === 'all' && <MaterialSymbol icon="check" size={15} />}
            </button>
            {onOpenItem && option.state !== 'none' && (
              <button
                type="button"
                className="tracker-milestone-picker-option-open"
                aria-label={`Open ${option.label}`}
                title={`Open ${option.label}`}
                onClick={() => onOpenItem(option.itemId)}
              >
                <MaterialSymbol icon="open_in_new" size={13} />
              </button>
            )}
          </div>
        ))}

        {canCreate && (
          <button
            type="button"
            role="option"
            aria-selected={false}
            data-active={activeIndex === createRowIndex}
            disabled={creating}
            className={activeIndex === createRowIndex
              ? 'tracker-milestone-picker-option tracker-milestone-picker-option-active'
              : 'tracker-milestone-picker-option'}
            onMouseEnter={() => setActiveIndex(createRowIndex)}
            onClick={() => void createAndAssign()}
            data-testid={`${testIdBase}-create`}
          >
            <MaterialSymbol icon="add" size={15} className="tracker-milestone-picker-option-icon" />
            <span className="tracker-milestone-picker-option-label">
              Create milestone &ldquo;{trimmedQuery}&rdquo;
            </span>
          </button>
        )}
      </div>

      {createError && (
        <div className="tracker-milestone-picker-error" role="alert">{createError}</div>
      )}
      {footer && <div className="tracker-milestone-picker-footer">{footer}</div>}
    </div>
  );
};
