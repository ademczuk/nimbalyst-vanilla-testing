/**
 * One card on the tracker board.
 *
 * Extracted from KanbanBoard when the card grew affordances of its own: a
 * checkbox that makes multi-select discoverable without a mode, a milestone chip
 * that reassigns without dragging, and a staleness chip that flags a plan whose
 * status disagrees with its commits.
 *
 * The DOM contract matters: the `tracker-kanban-card` class and `data-item-id`
 * are what the document-level drag handlers and the kanban E2E spec address.
 */

import React from 'react';
import { MaterialSymbol, TrackerUnreadDot } from '@nimbalyst/runtime';
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import { TrackerFavoriteStar } from '@nimbalyst/runtime/plugins/TrackerPlugin';
import {
  getFieldByRole,
  getRecordExternalKey,
  getRecordPriority,
  getRecordTitle,
} from '@nimbalyst/runtime/plugins/TrackerPlugin/trackerRecordAccessors';
import { UserAvatar } from '@nimbalyst/runtime/plugins/TrackerPlugin/components/UserAvatar';
import { NEUTRAL_SWATCH, PRIORITY_COLORS, TYPE_COLORS } from './trackerBoardTokens';
import { TrackerCardMilestoneChip } from './TrackerCardMilestoneChip';
import { TrackerCardStalenessChip } from './TrackerCardStalenessChip';
import './TrackerBoardCard.css';

export interface TrackerBoardCardProps {
  item: TrackerRecord;
  /**
   * The lane this rendering of the card sits in. A card in several milestones
   * renders once per lane, and the drop needs to know which copy was picked up.
   */
  columnKey: string;
  /** In the board's multi-selection; drives the checkbox. */
  selected: boolean;
  /** Open in the detail panel. Outlined like a selected card, but not checked. */
  highlighted: boolean;
  /** Being dragged right now. */
  dragging: boolean;
  isFavorite: boolean;
  onToggleFavorite?: (itemId: string) => void;
  onDragStart: (event: React.DragEvent, item: TrackerRecord, columnKey: string) => void;
  onDragEnd: () => void;
  onSelect: (event: React.MouseEvent, item: TrackerRecord) => void;
  /** Checkbox path: add or remove this card from the selection, nothing else. */
  onToggleSelected: (itemId: string) => void;
  onContextMenu: (event: React.MouseEvent, item: TrackerRecord) => void;
  onOpenDocument?: (itemId: string) => void;
  onOpenItem?: (itemId: string) => void;
}

export const TrackerBoardCard: React.FC<TrackerBoardCardProps> = ({
  item,
  columnKey,
  selected,
  highlighted,
  dragging,
  isFavorite,
  onToggleFavorite,
  onDragStart,
  onDragEnd,
  onSelect,
  onToggleSelected,
  onContextMenu,
  onOpenDocument,
  onOpenItem,
}) => {
  const priority = getRecordPriority(item);
  const typeColor = TYPE_COLORS[item.primaryType] || NEUTRAL_SWATCH;
  const owner = getFieldByRole(item, 'assignee') as string | undefined;
  // externalKey role (e.g. a PR number) rides next to the local issue key so
  // imported/external items stay recognizable on the board.
  const keyLine = [item.issueKey, getRecordExternalKey(item)].filter(Boolean).join(' · ');

  return (
    <div
      data-testid="tracker-kanban-card"
      data-item-id={item.id}
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(event) => onDragStart(event, item, columnKey)}
      onDragEnd={onDragEnd}
      className={`tracker-kanban-card w-full text-left p-2.5 rounded-md bg-nim hover:bg-nim-tertiary border transition-colors cursor-grab active:cursor-grabbing mb-1.5 ${
        dragging ? 'opacity-40' : ''
      } ${selected || highlighted ? 'border-[var(--nim-primary)]' : 'border-nim'}`}
      onClick={(event) => onSelect(event, item)}
      onDoubleClick={() => onOpenDocument?.(item.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(event as unknown as React.MouseEvent, item);
        }
      }}
      onContextMenu={(event) => onContextMenu(event, item)}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          draggable={false}
          className={`tracker-card-select-checkbox ${
            selected ? 'tracker-card-select-checkbox-checked' : 'tracker-card-select-checkbox-unchecked'
          }`}
          data-testid="tracker-card-select-checkbox"
          role="checkbox"
          aria-checked={selected}
          aria-label={selected ? 'Deselect card' : 'Select card'}
          title={selected ? 'Deselect' : 'Select for a bulk action'}
          onClick={(event) => {
            event.stopPropagation();
            onToggleSelected(item.id);
          }}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <MaterialSymbol icon="check" size={11} />
        </button>
        <span
          className="w-2 h-2 rounded-full mt-1.5 shrink-0"
          style={{ backgroundColor: PRIORITY_COLORS[priority || 'medium'] || NEUTRAL_SWATCH }}
        />
        <TrackerUnreadDot itemId={item.id} className="mt-1" />
        <TrackerFavoriteStar itemId={item.id} isFavorite={isFavorite} onToggle={onToggleFavorite} />
        <div className="flex-1 min-w-0">
          {keyLine ? (
            <div className="text-[10px] font-mono font-medium uppercase tracking-[0.08em] text-nim-faint mb-0.5">
              {keyLine}
            </div>
          ) : null}
          <div className="text-sm text-nim leading-snug line-clamp-2">
            {getRecordTitle(item)}
          </div>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            <span
              className="text-[10px] font-medium px-1.5 py-0.5 rounded"
              style={{ color: typeColor, backgroundColor: `${typeColor}20` }}
            >
              {item.primaryType}
            </span>
            {item.typeTags
              .filter(tag => tag !== item.primaryType)
              .map(tag => (
                <span
                  key={tag}
                  className="text-[9px] font-medium px-1 py-0.5 rounded"
                  style={{
                    color: TYPE_COLORS[tag] || NEUTRAL_SWATCH,
                    backgroundColor: `${TYPE_COLORS[tag] || NEUTRAL_SWATCH}12`,
                    border: `1px solid ${TYPE_COLORS[tag] || NEUTRAL_SWATCH}30`,
                  }}
                >
                  {tag}
                </span>
              ))}
            {priority && priority !== 'medium' ? (
              <span
                className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                style={{
                  color: PRIORITY_COLORS[priority] || NEUTRAL_SWATCH,
                  backgroundColor: `${PRIORITY_COLORS[priority] || NEUTRAL_SWATCH}20`,
                }}
              >
                {priority}
              </span>
            ) : null}
            <TrackerCardStalenessChip item={item} />
            <TrackerCardMilestoneChip item={item} onOpenItem={onOpenItem} />
            {owner ? (
              <span className="ml-auto">
                <UserAvatar identity={owner} size={18} />
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};
