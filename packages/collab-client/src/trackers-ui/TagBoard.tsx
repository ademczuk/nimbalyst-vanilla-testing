import React, { useMemo } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import {
  getRecordTitle,
  getRecordPriority,
  getFieldByRole,
} from '@nimbalyst/runtime/plugins/TrackerPlugin/trackerRecordAccessors';
import { UserAvatar } from '@nimbalyst/runtime/plugins/TrackerPlugin/components/UserAvatar';
import { groupTrackerItemsByTag } from '@nimbalyst/collab-client/trackers';
import { TrackerSurfaceMessage } from './primitives/TrackerSurfaceMessage';
import { TrackerSwatchBadge } from './primitives/TrackerSwatchBadge';
import { NEUTRAL_SWATCH, PRIORITY_COLORS, TYPE_COLORS } from './board/trackerBoardTokens';

export interface TagBoardProps {
  /** Items already composed through the active saved view. */
  items: TrackerRecord[];
  /** Callback when user clicks a card to open the detail panel. */
  onItemSelect?: (itemId: string) => void;
  /** Currently selected item ID for card highlighting. */
  selectedItemId?: string | null;
  /** Open a card's item as a document (double-click). */
  onOpenDocument?: (itemId: string) => void;
  /** Personal lane, desktop only. Omitted by a host with team auth only. */
  renderUnreadSlot?: (itemId: string) => React.ReactNode;
  /** Personal lane, desktop only. Omitted by a host with team auth only. */
  renderFavoriteSlot?: (itemId: string) => React.ReactNode;
}

/**
 * Tag board view. Columns are driven by the schema `tags` role —
 * one column per distinct tag plus a trailing "Untagged" bucket. An item with
 * multiple tags shows up in every matching column. Read + click-to-select; the
 * kanban board remains the place for drag-driven status changes.
 */
export const TagBoard: React.FC<TagBoardProps> = ({
  items,
  onItemSelect,
  selectedItemId,
  onOpenDocument,
  renderUnreadSlot,
  renderFavoriteSlot,
}) => {
  const columns = useMemo(() => groupTrackerItemsByTag(items), [items]);

  if (items.length === 0) {
    return <TrackerSurfaceMessage icon="sell" message="No items to display" />;
  }

  if (columns.length === 0) {
    return (
      <TrackerSurfaceMessage
        icon="sell"
        message="No tags on these items yet"
        hint="Add tags to group them on the tag board."
      />
    );
  }

  return (
    <div className="tracker-tag-board h-full flex flex-col overflow-hidden relative" data-testid="tracker-tag-board">
      <div className="flex-1 flex gap-3 p-3 overflow-x-auto overflow-y-hidden min-h-0">
        {columns.map((col) => {
          const key = col.tag ?? '__untagged__';
          return (
            <div
              key={key}
              data-testid={`tracker-tag-board-column-${key}`}
              data-tag={col.tag ?? ''}
              className="tracker-tag-board-column flex flex-col min-w-[260px] max-w-[320px] flex-1 min-h-0 rounded-lg bg-nim-secondary"
            >
              {/* Column header */}
              <div className="flex items-center gap-2 px-3 py-2 border-b border-nim">
                <MaterialSymbol
                  icon={col.tag === null ? 'label_off' : 'sell'}
                  size={13}
                  className="text-nim-faint shrink-0"
                />
                <span className="text-xs font-semibold text-nim truncate">
                  {col.tag === null ? 'Untagged' : `#${col.label}`}
                </span>
                <span className="text-[10px] font-semibold text-nim-faint ml-auto">{col.items.length}</span>
              </div>

              {/* Column cards */}
              <div className="flex-1 overflow-y-auto p-1.5">
                {col.items.map((item) => (
                  <div
                    key={item.id}
                    data-testid="tracker-tag-board-card"
                    data-item-id={item.id}
                    role="button"
                    tabIndex={0}
                    className={`w-full text-left p-2.5 rounded-md bg-nim hover:bg-nim-tertiary border transition-colors cursor-pointer mb-1.5 ${
                      item.id === selectedItemId ? 'border-[var(--nim-primary)]' : 'border-nim'
                    }`}
                    onClick={() => onItemSelect?.(item.id)}
                    onDoubleClick={() => onOpenDocument?.(item.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onItemSelect?.(item.id);
                      }
                    }}
                  >
                    <div className="flex items-start gap-2">
                      <span
                        className="w-2 h-2 rounded-full mt-1.5 shrink-0"
                        style={{
                          backgroundColor: PRIORITY_COLORS[getRecordPriority(item) || 'medium'] || NEUTRAL_SWATCH,
                        }}
                      />
                      {renderUnreadSlot?.(item.id)}
                      {renderFavoriteSlot?.(item.id)}
                      <div className="flex-1 min-w-0">
                        {item.issueKey && (
                          <div className="text-[10px] font-mono font-medium uppercase tracking-[0.08em] text-nim-faint mb-0.5">
                            {item.issueKey}
                          </div>
                        )}
                        <div className="text-sm text-nim leading-snug line-clamp-2">{getRecordTitle(item)}</div>
                        <div className="flex items-center gap-1.5 mt-1.5">
                          <TrackerSwatchBadge
                            label={item.primaryType}
                            color={TYPE_COLORS[item.primaryType] || NEUTRAL_SWATCH}
                          />
                          {(() => {
                            const owner = getFieldByRole(item, 'assignee') as string | undefined;
                            return owner ? (
                              <span className="ml-auto">
                                <UserAvatar identity={owner} size={18} />
                              </span>
                            ) : null;
                          })()}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                {/* Spacer */}
                <div className="min-h-[40px]" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
