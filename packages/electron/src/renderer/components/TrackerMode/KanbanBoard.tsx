import React, { useEffect, useMemo, useCallback, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { useFloating, offset, flip, shift, FloatingPortal } from '@floating-ui/react';
import { windowControlsClearance } from '@nimbalyst/runtime/ui/floating/windowControlsClearance';
import { MaterialSymbol } from '@nimbalyst/runtime';
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import { type TrackerItemType } from '@nimbalyst/runtime/plugins/TrackerPlugin';
import { MANUAL_TRACKER_ORDERING, type TrackerGroupBy, type TrackerOrdering } from '@nimbalyst/runtime/plugins/TrackerPlugin/models';
import { buildKanbanStatusColumns, getRecordTitle, resolveRoleFieldName } from '@nimbalyst/runtime/plugins/TrackerPlugin/trackerRecordAccessors';
import { trackerRelationshipLabelAtom } from '@nimbalyst/runtime/plugins/TrackerPlugin/trackerDataAtoms';
import { trackerModeStatusScopeAtom } from '../../store/atoms/trackers';
import {
  buildTrackerBoardColumns,
  groupItemsIntoBoardColumns,
  resolveBoardAxis,
  resolveBoardDrop,
} from './trackerBoardColumns';
import { saveTrackerFields, saveTrackerFieldsBatch } from './trackerFieldSave';
import { registerKanbanDragCallbacks } from './kanbanDragListeners';
import { KanbanContextSubmenu } from './KanbanContextSubmenu';
import { KanbanBoardSelectionBar } from './KanbanBoardSelectionBar';
import { TrackerBoardCard } from './TrackerBoardCard';
import { NEUTRAL_SWATCH, PRIORITY_COLORS, STATUS_COLORS } from './trackerBoardTokens';

interface KanbanBoardProps {
  filterType: TrackerItemType | 'all';
  /** Grouping axis from the saved view; `none` lays the board out by status. */
  groupBy?: TrackerGroupBy;
  /** Within-column order from the saved view: manual drag order, or a field. */
  ordering?: TrackerOrdering;
  searchQuery?: string;
  onSwitchToFilesMode?: () => void;
  /** Callback when user clicks a card to select an item (opens detail panel) */
  onItemSelect?: (itemId: string) => void;
  /** Currently selected item ID for card highlighting */
  selectedItemId?: string | null;
  /** Override items instead of loading from documentService (used for filtered views) */
  overrideItems?: TrackerRecord[];
  /** Callback for bulk/single archive action */
  onArchiveItems?: (itemIds: string[], archive: boolean) => void;
  /** Callback for bulk/single delete action */
  onDeleteItems?: (itemIds: string[]) => void;
  /** Copy a shareable deep link for the given tracker item. Only shown when
   *  exactly one item is selected. Callers omit this when the workspace
   *  has no team configured. */
  onCopyDeepLink?: (itemId: string) => void;
  /** Open a card's item as a document -- double-click and the card context menu. */
  onOpenDocument?: (itemId: string) => void;
  favoriteItemIds?: ReadonlySet<string>;
  onToggleFavorite?: (itemId: string) => void;
}

export const KanbanBoard: React.FC<KanbanBoardProps> = ({
  filterType,
  groupBy = 'none',
  ordering = MANUAL_TRACKER_ORDERING,
  searchQuery,
  onSwitchToFilesMode,
  onItemSelect,
  selectedItemId,
  overrideItems,
  onArchiveItems,
  onDeleteItems,
  onCopyDeepLink,
  onOpenDocument,
  favoriteItemIds = new Set<string>(),
  onToggleFavorite,
}) => {
  // Items always come from the caller (TrackerMainView passes atom-sourced items).
  // KanbanBoard no longer loads its own data -- single source of truth via Jotai atoms.
  const allItems = useMemo(() => {
    const source = overrideItems ?? [];
    if (!searchQuery) return source;
    const q = searchQuery.toLowerCase();
    return source.filter(
      record =>
        record.issueKey?.toLowerCase().includes(q) ||
        String(record.issueNumber ?? '').includes(q) ||
        getRecordTitle(record).toLowerCase().includes(q) ||
        record.system.documentPath?.toLowerCase().includes(q)
    );
  }, [searchQuery, overrideItems]);

  // Drag-and-drop state
  const [dragItemId, setDragItemId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const dragOverColumnRef = useRef<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const dropIndexRef = useRef<number | null>(null);
  const dragItemRef = useRef<TrackerRecord | null>(null);
  // Which lane the card was picked up from. On a multi-value axis the same card
  // renders in several lanes, so the drop cannot infer this from membership.
  const dragSourceColumnRef = useRef<string | null>(null);

  /**
   * All board writes go through the shared field-save path, so a milestone
   * drag gets the same customFields nesting, inverse propagation, and
   * relationship reindex the detail panel's collection chip gets.
   */
  const updateItemFields = useCallback(
    (record: TrackerRecord, updates: Record<string, unknown>) => saveTrackerFields(record, updates),
    [],
  );

  const handleDragStart = useCallback((e: React.DragEvent, item: TrackerRecord, columnKey: string) => {
    // console.log('[KanbanBoard] dragStart:', item.id, getRecordTitle(item));
    setDragItemId(item.id);
    dragItemRef.current = item;
    dragSourceColumnRef.current = columnKey;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', item.id);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDragItemId(null);
    setDragOverColumn(null);
    setDropIndex(null);
    dragItemRef.current = null;
    dragSourceColumnRef.current = null;
  }, []);

  // Multi-select state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [contextAnchor, setContextAnchor] = useState<DOMRect | null>(null);
  const allItemsRef = useRef<TrackerRecord[]>([]);
  const lastClickedIdRef = useRef<string | null>(null);

  // Floating context menu
  const { refs: contextRefs, floatingStyles: contextFloatingStyles } = useFloating({
    placement: 'right-start',
    middleware: [offset(2), flip({ padding: 8 }), shift({ padding: 8 }), windowControlsClearance()],
  });
  useEffect(() => {
    if (contextAnchor) {
      contextRefs.setReference({ getBoundingClientRect: () => contextAnchor });
    }
  }, [contextAnchor, contextRefs]);

  // Keep ref in sync
  useEffect(() => { allItemsRef.current = allItems; }, [allItems]);

  const handleCardContextMenu = useCallback((e: React.MouseEvent, item: TrackerRecord) => {
    e.preventDefault();
    e.stopPropagation();
    // If right-clicking an unselected item, select just that item
    if (!selectedIds.has(item.id)) {
      setSelectedIds(new Set([item.id]));
    }
    setContextAnchor(DOMRect.fromRect({ x: e.clientX, y: e.clientY, width: 0, height: 0 }));
  }, [selectedIds]);

  const closeContextMenu = useCallback(() => setContextAnchor(null), []);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextAnchor) return;
    const handler = () => setContextAnchor(null);
    document.addEventListener('click', handler);
    document.addEventListener('contextmenu', handler);
    return () => {
      document.removeEventListener('click', handler);
      document.removeEventListener('contextmenu', handler);
    };
  }, [contextAnchor]);

  // Clear selection on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedIds(new Set());
        closeContextMenu();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [closeContextMenu]);

  /**
   * Bulk field change from the context menu, as one batched write.
   *
   * `role` is resolved per item because a custom tracker type can map status or
   * priority onto a differently named field.
   */
  const handleBulkRoleUpdate = useCallback(async (
    role: 'workflowStatus' | 'priority',
    value: string,
  ) => {
    closeContextMenu();
    const entries = allItemsRef.current
      .filter(item => selectedIds.has(item.id))
      .map(item => ({
        item,
        updates: { [resolveRoleFieldName(item.primaryType, role)]: value },
      }));
    await saveTrackerFieldsBatch(entries);
  }, [selectedIds, closeContextMenu]);

  const relationshipLabel = useAtomValue(trackerRelationshipLabelAtom);
  const boardAxis = resolveBoardAxis(groupBy);
  const statusScope = useAtomValue(trackerModeStatusScopeAtom);
  const columns = useMemo(
    () => buildTrackerBoardColumns(groupBy, filterType, allItems, relationshipLabel, statusScope),
    [groupBy, filterType, allItems, relationshipLabel, statusScope],
  );
  const columnsByKey = useMemo(
    () => new Map(columns.map(col => [col.key, col])),
    [columns],
  );

  const itemsByColumn = useMemo(
    () => groupItemsIntoBoardColumns(allItems, columns, boardAxis, ordering),
    [allItems, columns, boardAxis, ordering],
  );

  /** The context menu sets status whatever the board is grouped by. */
  const statusColumns = useMemo(
    () => buildKanbanStatusColumns(filterType, allItems),
    [filterType, allItems],
  );

  // Flat ordered list of item IDs (column by column) for shift-range selection
  const flatItemIds = useMemo(() => {
    const ids: string[] = [];
    for (const col of columns) {
      for (const item of itemsByColumn[col.key] || []) ids.push(item.id);
    }
    return ids;
  }, [columns, itemsByColumn]);

  // Keep the layout in refs so the drop handlers don't depend on them (avoids stale closures)
  const itemsByColumnRef = useRef(itemsByColumn);
  useEffect(() => { itemsByColumnRef.current = itemsByColumn; }, [itemsByColumn]);
  const columnsByKeyRef = useRef(columnsByKey);
  useEffect(() => { columnsByKeyRef.current = columnsByKey; }, [columnsByKey]);
  const boardAxisRef = useRef(boardAxis);
  useEffect(() => { boardAxisRef.current = boardAxis; }, [boardAxis]);

  const handleCardSelect = useCallback((e: React.MouseEvent, item: TrackerRecord) => {
    e.stopPropagation();
    if (e.shiftKey && lastClickedIdRef.current) {
      // Range select between anchor and target
      const anchorIdx = flatItemIds.indexOf(lastClickedIdRef.current);
      const targetIdx = flatItemIds.indexOf(item.id);
      if (anchorIdx !== -1 && targetIdx !== -1) {
        const start = Math.min(anchorIdx, targetIdx);
        const end = Math.max(anchorIdx, targetIdx);
        const rangeIds = flatItemIds.slice(start, end + 1);
        if (e.metaKey || e.ctrlKey) {
          // Add range to existing selection
          setSelectedIds(prev => {
            const next = new Set(prev);
            for (const id of rangeIds) next.add(id);
            return next;
          });
        } else {
          // Replace with range
          setSelectedIds(new Set(rangeIds));
        }
      }
      // Don't update anchor on shift-click
    } else if (e.metaKey || e.ctrlKey) {
      // Toggle individual
      lastClickedIdRef.current = item.id;
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(item.id)) next.delete(item.id);
        else next.add(item.id);
        return next;
      });
    } else {
      // Replace selection and open detail
      lastClickedIdRef.current = item.id;
      setSelectedIds(new Set([item.id]));
      if (onItemSelect && item.id) {
        onItemSelect(item.id);
      }
    }
  }, [onItemSelect, flatItemIds]);

  /**
   * The checkbox path into multi-select: additive, and never opens the detail
   * panel, so building a selection of many cards needs no modifier keys.
   */
  const handleToggleCardSelected = useCallback((itemId: string) => {
    lastClickedIdRef.current = itemId;
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  /** The selected records, in board order, for the selection bar's bulk actions. */
  const selectedItems = useMemo(
    () => (selectedIds.size === 0 ? [] : allItems.filter(item => selectedIds.has(item.id))),
    [allItems, selectedIds],
  );

  // The listeners on `document` are attached once and survive HMR; this only
  // points them at the mounted board.
  useEffect(() => registerKanbanDragCallbacks({
    onDragOver: (columnKey: string, idx: number) => {
      dragOverColumnRef.current = columnKey;
      dropIndexRef.current = idx;
      setDragOverColumn(columnKey);
      setDropIndex(idx);
    },

    onDrop: () => {
      const targetKey = dragOverColumnRef.current;
      const currentDropIdx = dropIndexRef.current;

      dragOverColumnRef.current = null;
      setDragOverColumn(null);
      setDropIndex(null);
      dropIndexRef.current = null;
      setDragItemId(null);

      const item = dragItemRef.current;
      const sourceColumnKey = dragSourceColumnRef.current;
      dragItemRef.current = null;
      dragSourceColumnRef.current = null;
      if (!item || !targetKey) return;

      const targetColumn = columnsByKeyRef.current.get(targetKey);
      if (!targetColumn) return;

      const updates = resolveBoardDrop({
        item,
        axis: boardAxisRef.current,
        sourceColumnKey,
        targetColumn,
        columnItems: itemsByColumnRef.current[targetKey] || [],
        dropIndex: currentDropIdx,
      });
      if (updates) updateItemFields(item, updates);
    },

    onDragLeave: () => {
      setDragOverColumn(null);
      setDropIndex(null);
    },
  }));

  if (allItems.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-nim-muted">
        <div className="text-center">
          <MaterialSymbol icon="view_kanban" size={48} className="opacity-30" />
          <p className="mt-2 text-sm">No items to display</p>
        </div>
      </div>
    );
  }

  return (
    <div className="tracker-kanban-board h-full flex flex-col overflow-hidden relative" data-testid="tracker-kanban-board">
    <div className="flex-1 flex gap-3 p-3 overflow-x-auto overflow-y-hidden min-h-0">
      {columns.map((col) => {
        const colItems = itemsByColumn[col.key] || [];
        const color = (col.value && STATUS_COLORS[col.value]) || NEUTRAL_SWATCH;

        return (
          <div
            key={col.key}
            data-testid={`tracker-kanban-column-${col.key}`}
            data-column-key={col.key}
            className={`tracker-kanban-column flex flex-col min-w-[260px] max-w-[320px] flex-1 min-h-0 rounded-lg transition-colors bg-nim-secondary ${
              // The no-value bucket is the triage queue, not a real lane.
              col.empty ? 'tracker-kanban-column-empty-bucket border border-dashed border-nim' : ''
            } ${
              dragOverColumn === col.key ? 'ring-1 ring-[var(--nim-primary)]' : ''
            }`}
          >
            {/* Column header */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-nim">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${col.empty ? 'border border-nim' : ''}`}
                style={col.empty ? undefined : { backgroundColor: color }}
              />
              <span className="text-xs font-semibold text-nim truncate">
                {col.label}
              </span>
              <span className="text-[10px] font-semibold text-nim-faint ml-auto">
                {colItems.length}
              </span>
            </div>

            {/* Column cards */}
            <div className="kanban-cards-container flex-1 overflow-y-auto p-1.5">
              {colItems.map((item, cardIndex) => (
                <React.Fragment key={item.id}>
                  {/* Drop insertion line */}
                  {dragOverColumn === col.key && dropIndex === cardIndex && dragItemId !== item.id && (
                    <div className="h-[2px] bg-[var(--nim-primary)] rounded-full mx-1 my-0.5" />
                  )}
                <TrackerBoardCard
                  item={item}
                  columnKey={col.key}
                  selected={selectedIds.has(item.id)}
                  highlighted={Boolean(selectedItemId) && item.id === selectedItemId}
                  dragging={dragItemId === item.id}
                  isFavorite={favoriteItemIds.has(item.id)}
                  onToggleFavorite={onToggleFavorite}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onSelect={handleCardSelect}
                  onToggleSelected={handleToggleCardSelected}
                  onContextMenu={handleCardContextMenu}
                  onOpenDocument={onOpenDocument}
                  onOpenItem={onItemSelect}
                />
                </React.Fragment>
              ))}
              {/* Drop indicator after last card */}
              {dragOverColumn === col.key && dropIndex === colItems.length && (
                <div className="h-[2px] bg-[var(--nim-primary)] rounded-full mx-1 my-0.5" />
              )}
              {/* Drop zone spacer -- ensures there's always a target area below the last card */}
              <div className="min-h-[40px]" />
            </div>
          </div>
        );
      })}
    </div>

      {/* Multi-select's visible state: present while something is selected, gone
          on Clear or Escape. Deliberately not a mode toggle. */}
      {selectedItems.length > 0 && (
        <KanbanBoardSelectionBar items={selectedItems} onClearSelection={clearSelection} />
      )}

      {/* Context menu */}
      {contextAnchor && selectedIds.size > 0 && (
        <FloatingPortal>
        <div
          ref={contextRefs.setFloating}
          className="z-50 min-w-[180px] bg-nim-secondary border border-nim rounded-md shadow-lg py-1 text-[13px]"
          style={contextFloatingStyles}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1 text-[11px] text-nim-faint font-medium">
            {selectedIds.size} item{selectedIds.size > 1 ? 's' : ''} selected
          </div>
          <div className="border-b border-nim my-1" />

          {/* Set Status */}
          <KanbanContextSubmenu label="Set Status" icon="swap_horiz">
            {statusColumns.map(col => (
              <button
                key={col.value}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-nim hover:bg-nim-tertiary cursor-pointer"
                onClick={() => handleBulkRoleUpdate('workflowStatus', col.value)}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: STATUS_COLORS[col.value] || NEUTRAL_SWATCH }}
                />
                {col.label}
              </button>
            ))}
          </KanbanContextSubmenu>

          {/* Set Priority */}
          <KanbanContextSubmenu label="Set Priority" icon="flag">
            {(['critical', 'high', 'medium', 'low'] as const).map(p => (
              <button
                key={p}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-nim hover:bg-nim-tertiary cursor-pointer"
                onClick={() => handleBulkRoleUpdate('priority', p)}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: PRIORITY_COLORS[p] || NEUTRAL_SWATCH }}
                />
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </KanbanContextSubmenu>

          <div className="border-b border-nim my-1" />

          {onOpenDocument && selectedIds.size === 1 && (
            <button
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-nim hover:bg-nim-tertiary cursor-pointer"
              data-testid="tracker-kanban-context-open-document"
              onClick={() => {
                const [onlyId] = selectedIds;
                closeContextMenu();
                onOpenDocument(onlyId);
              }}
            >
              <MaterialSymbol icon="article" size={16} />
              Open document
            </button>
          )}

          {onCopyDeepLink && selectedIds.size === 1 && (
            <button
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-nim hover:bg-nim-tertiary cursor-pointer"
              onClick={() => {
                const [onlyId] = selectedIds;
                closeContextMenu();
                onCopyDeepLink(onlyId);
              }}
            >
              <MaterialSymbol icon="link" size={16} />
              Copy Link
            </button>
          )}

          {onArchiveItems && (
            <button
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-nim hover:bg-nim-tertiary cursor-pointer"
              onClick={() => {
                closeContextMenu();
                onArchiveItems(Array.from(selectedIds), true);
                setSelectedIds(new Set());
              }}
            >
              <MaterialSymbol icon="archive" size={16} />
              Archive
            </button>
          )}

          {onDeleteItems && (
            <button
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[#ef4444] hover:bg-nim-tertiary cursor-pointer"
              onClick={() => {
                closeContextMenu();
                const ids = Array.from(selectedIds);
                if (window.confirm(`Delete ${ids.length} item${ids.length > 1 ? 's' : ''}? This cannot be undone.`)) {
                  onDeleteItems(ids);
                  setSelectedIds(new Set());
                }
              }}
            >
              <MaterialSymbol icon="delete" size={16} />
              Delete
            </button>
          )}
        </div>
        </FloatingPortal>
      )}
    </div>
  );
};
