import type { JSX } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import {
  DisplayOptionsPanel,
  type TrackerColumnDef,
  type TypeColumnConfig,
} from '@nimbalyst/runtime/plugins/TrackerPlugin';
import {
  clausesForField,
  isClauseComplete,
  opsForFieldType,
  OP_LABELS,
  UNARY_OPS,
  type FieldType,
  type TrackerFieldFilter,
  type TrackerFilterOp,
  type TrackerFilterSet,
} from '@nimbalyst/runtime/plugins/TrackerPlugin/models';
import {
  setTrackerModeLayoutAtom,
  trackerModeGroupByAtom,
  trackerModeOrderingAtom,
  trackerModeViewModeAtom,
} from '../../store/atoms/trackers';
import { TrackerAdvancedFilterBuilder } from './TrackerAdvancedFilterBuilder';
import { TrackerFilterValueMenu } from './TrackerFilterValueMenu';
import { TRACKER_VIEW_MODE_OPTIONS, normalizeTrackerViewMode } from './trackerViewModes';

export interface TrackerFilterField {
  id: string;
  label: string;
  type?: FieldType;
  multiValue?: boolean;
  options?: Array<{
    value: string;
    label: string;
    count?: number;
    color?: string;
    icon?: string;
  }>;
  group?: 'common' | 'custom' | 'system';
}

interface TrackerViewHeaderControlsProps {
  itemCount: number;
  availableColumns: TrackerColumnDef[];
  columnConfig: TypeColumnConfig;
  onColumnConfigChange: (config: TypeColumnConfig) => void;
  /**
   * Whether the rendered view has table columns. Display Settings opens either
   * way -- it owns view mode, grouping, and ordering too -- but the column
   * property list only applies to the list and table renderings.
   */
  showColumnControls: boolean;
  filterFields: TrackerFilterField[];
  filters: TrackerFilterSet | null;
  onFiltersChange: (filters: TrackerFilterSet) => void;
  openFiltersToken?: number;
}

function iconForField(field: TrackerFilterField): string {
  const key = `${field.id} ${field.label}`.toLowerCase();
  if (key.includes('favorite') || key.includes('starred')) return 'star';
  if (key.includes('status')) return 'progress_activity';
  if (key.includes('priority')) return 'signal_cellular_alt';
  if (key.includes('assignee') || key.includes('owner') || field.type === 'user') return 'person';
  if (key.includes('tag') || key.includes('label')) return 'sell';
  if (key.includes('relation') || field.type === 'relationship' || field.type === 'reference') return 'account_tree';
  if (key.includes('date') || key.includes('created') || key.includes('updated')) return 'calendar_today';
  if (key.includes('type')) return 'category';
  if (key.includes('source') || key.includes('module')) return 'deployed_code';
  if (field.type === 'boolean') return 'toggle_on';
  if (field.type === 'number') return 'numbers';
  if (field.type === 'array' || field.type === 'multiselect') return 'list';
  return 'text_fields';
}

function filterValueLabel(
  value: unknown,
  op?: TrackerFilterOp,
  field?: TrackerFilterField,
): string {
  if (value === undefined) return '';
  // Show what the field calls the value ("Yes", "To do"), not its stored form.
  const label = (item: unknown): string => {
    const text = String(item);
    return field?.options?.find(option => option.value === text)?.label ?? text;
  };
  const text = Array.isArray(value) ? value.map(label).join(', ') : label(value);
  return op === 'in-last' || op === 'not-in-last' ? `${text} days` : text;
}

type FilterMenuMode = 'fields' | 'field' | 'advanced';

export function TrackerViewHeaderControls({
  itemCount,
  availableColumns,
  columnConfig,
  onColumnConfigChange,
  showColumnControls,
  filterFields,
  filters,
  onFiltersChange,
  openFiltersToken = 0,
}: TrackerViewHeaderControlsProps): JSX.Element {
  const [showFilters, setShowFilters] = useState(false);
  const [showDisplayOptions, setShowDisplayOptions] = useState(false);
  const [menuMode, setMenuMode] = useState<FilterMenuMode>('fields');
  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [selectedFieldRect, setSelectedFieldRect] = useState<DOMRect | null>(null);
  const [quickOp, setQuickOp] = useState<TrackerFilterOp>('=');
  const [quickValue, setQuickValue] = useState<unknown>('');
  const filterRootRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const displayOptionsButtonRef = useRef<HTMLButtonElement>(null);

  // View mode, grouping, and ordering are saved-view state, not local
  // presentation: Display Settings writes the same layout the view definition
  // captures, so a chosen axis is saved and restored with the view.
  const viewMode = useAtomValue(trackerModeViewModeAtom);
  const groupBy = useAtomValue(trackerModeGroupByAtom);
  const ordering = useAtomValue(trackerModeOrderingAtom);
  const setModeLayout = useSetAtom(setTrackerModeLayoutAtom);

  const activeFilterCount = useMemo(
    () => (filters?.clauses ?? []).filter(isClauseComplete).length,
    [filters],
  );
  const selectedField = useMemo(
    () => filterFields.find(field => field.id === selectedFieldId),
    [filterFields, selectedFieldId],
  );
  const matchingFields = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return filterFields;
    return filterFields.filter(field =>
      field.label.toLowerCase().includes(normalizedQuery)
      || field.id.toLowerCase().includes(normalizedQuery));
  }, [filterFields, query]);

  const resetFilterMenu = (): void => {
    setMenuMode('fields');
    setQuery('');
    setHighlightedIndex(0);
    setSelectedFieldId(null);
    setSelectedFieldRect(null);
  };

  useEffect(() => {
    if (openFiltersToken <= 0) return;
    resetFilterMenu();
    setShowDisplayOptions(false);
    setShowFilters(true);
    // The token is the explicit open signal. Filter option-count refreshes must
    // not reset a submenu that is already being used.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFiltersToken]);

  useEffect(() => {
    if (!showFilters) return;
    const closeOnOutsideClick = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (
        !filterRootRef.current?.contains(target)
        && !submenuRef.current?.contains(target)
      ) {
        setShowFilters(false);
      }
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, [showFilters]);

  const openField = (field: TrackerFilterField, anchorRect?: DOMRect): void => {
    setSelectedFieldId(field.id);
    setSelectedFieldRect(anchorRect ?? null);
    setQuickOp(opsForFieldType(field.type)[0]);
    setQuickValue('');
    setMenuMode('field');
  };

  const applyQuickFilter = (
    value: unknown = quickValue,
    opOverride?: TrackerFilterOp,
  ): void => {
    if (!selectedField) return;
    const effectiveOp = opOverride ?? quickOp;
    let clause: TrackerFieldFilter;
    if (UNARY_OPS.has(effectiveOp)) {
      clause = { field: selectedField.id, op: effectiveOp };
    } else if (effectiveOp === 'in' || effectiveOp === 'not-in') {
      const values = Array.isArray(value)
        ? value
        : String(value).split(',').map(item => item.trim()).filter(Boolean);
      clause = { field: selectedField.id, op: effectiveOp, value: values };
    } else if (effectiveOp === 'between') {
      clause = {
        field: selectedField.id,
        op: effectiveOp,
        value: Array.isArray(value) ? value : ['', ''],
      };
    } else {
      clause = { field: selectedField.id, op: effectiveOp, value };
    }
    if (!isClauseComplete(clause)) return;
    const existingClauses = (filters?.clauses ?? []).filter(isClauseComplete);
    const shouldReplaceField = Array.isArray(value)
      && (
        selectedField.type === 'array'
        || selectedField.type === 'multiselect'
        || selectedField.multiValue === true
      );
    onFiltersChange({
      combinator: filters?.combinator ?? 'and',
      clauses: [
        ...existingClauses.filter(existing =>
          !shouldReplaceField || existing.field !== selectedField.id),
        clause,
      ],
    });
    setMenuMode('fields');
    setSelectedFieldId(null);
    setSelectedFieldRect(null);
    setQuickValue('');
    setShowFilters(false);
  };

  const removeActiveFilter = (index: number): void => {
    onFiltersChange({
      combinator: filters?.combinator ?? 'and',
      clauses: (filters?.clauses ?? []).filter((_, clauseIndex) => clauseIndex !== index),
    });
  };

  return (
    <div
      className="tracker-view-header-controls flex shrink-0 items-center gap-1.5"
      data-testid="tracker-view-header-controls"
    >
      <span
        className="min-w-8 text-right text-[11px] tabular-nums text-nim-faint"
        data-testid="tracker-view-item-count"
      >
        {itemCount} item{itemCount === 1 ? '' : 's'}
      </span>

      <div className="relative" ref={filterRootRef}>
        <button
          type="button"
          className={`inline-flex h-7 items-center gap-1 rounded border px-2 text-[11px] font-medium transition-colors ${
            showFilters || activeFilterCount > 0
              ? 'border-nim-focus bg-nim-tertiary text-nim'
              : 'border-nim bg-nim-secondary text-nim-muted hover:bg-nim-tertiary hover:text-nim'
          }`}
          onClick={() => {
            setShowDisplayOptions(false);
            if (showFilters) {
              setShowFilters(false);
            } else {
              resetFilterMenu();
              setShowFilters(true);
            }
          }}
          aria-expanded={showFilters}
          data-testid="tracker-view-filter-button"
        >
          <MaterialSymbol icon="filter_list" size={14} />
          Filter
          {activeFilterCount > 0 && (
            <span className="rounded-full bg-[var(--nim-primary)] px-1.5 text-[10px] leading-4 text-white">
              {activeFilterCount}
            </span>
          )}
        </button>

        {showFilters && (
          <div
            className={`absolute right-0 top-full z-50 mt-1 max-w-[calc(100vw-24px)] overflow-hidden rounded-xl border border-nim bg-nim-secondary shadow-xl ${
              menuMode === 'advanced' ? 'w-[620px]' : 'w-[360px]'
            }`}
            role="dialog"
            aria-label="Tracker filters"
            data-testid="tracker-filter-builder"
          >
            {menuMode !== 'advanced' && (
              <>
                <div className="relative border-b border-nim p-3">
                  <MaterialSymbol
                    icon="search"
                    size={17}
                    className="absolute left-4 top-1/2 -translate-y-1/2 text-nim-faint"
                  />
                  <input
                    autoFocus
                    className="h-9 w-full rounded-md border border-transparent bg-transparent pl-8 pr-10 text-[15px] text-nim outline-none placeholder:text-nim-faint focus:border-nim-focus"
                    placeholder="Add filter…"
                    value={query}
                    onChange={event => {
                      setQuery(event.target.value);
                      setHighlightedIndex(0);
                    }}
                    onKeyDown={event => {
                      const itemCount = matchingFields.length + 1;
                      if (event.key === 'ArrowDown') {
                        event.preventDefault();
                        setHighlightedIndex(index => Math.min(index + 1, itemCount - 1));
                      } else if (event.key === 'ArrowUp') {
                        event.preventDefault();
                        setHighlightedIndex(index => Math.max(index - 1, 0));
                      } else if (event.key === 'Enter') {
                        event.preventDefault();
                        if (highlightedIndex === 0) setMenuMode('advanced');
                        else if (matchingFields[highlightedIndex - 1]) {
                          const field = matchingFields[highlightedIndex - 1];
                          const row = filterRootRef.current?.querySelector(
                            `[data-testid="tracker-filter-field-${field.id}"]`,
                          );
                          openField(field, row?.getBoundingClientRect());
                        }
                      } else if (event.key === 'Escape') {
                        setShowFilters(false);
                      }
                    }}
                    data-testid="tracker-filter-command-search"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 rounded border border-nim px-1.5 py-0.5 text-[10px] text-nim-faint">
                    F
                  </span>
                </div>

                {activeFilterCount > 0 && (
                  <div className="border-b border-nim px-2 py-2" data-testid="tracker-filter-active-list">
                    <div className="px-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-nim-faint">
                      Active filters
                    </div>
                    {(filters?.clauses ?? []).map((clause, index) => {
                      if (!isClauseComplete(clause)) return null;
                      const field = filterFields.find(candidate => candidate.id === clause.field);
                      return (
                        <div
                          key={`${clause.field}-${index}`}
                          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-nim"
                        >
                          <MaterialSymbol icon={iconForField(field ?? {
                            id: clause.field,
                            label: clause.field,
                          })} size={15} className="text-nim-faint" />
                          <span className="min-w-0 flex-1 truncate">
                            {field?.label ?? clause.field}{' '}
                            <span className="text-nim-muted">{OP_LABELS[clause.op]}</span>{' '}
                            {filterValueLabel(clause.value, clause.op, field)}
                          </span>
                          <button
                            type="button"
                            className="rounded p-0.5 text-nim-faint hover:bg-nim-tertiary hover:text-nim"
                            onClick={() => removeActiveFilter(index)}
                            aria-label={`Remove ${field?.label ?? clause.field} filter`}
                          >
                            <MaterialSymbol icon="close" size={13} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="border-b border-nim p-2">
                  <button
                    type="button"
                    className={highlightedIndex === 0
                      ? 'flex w-full items-center gap-3 rounded-md bg-nim-tertiary px-3 py-2 text-left text-[14px] text-nim'
                      : 'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-[14px] text-nim hover:bg-nim-tertiary'}
                    onMouseEnter={() => {
                      setHighlightedIndex(0);
                      setMenuMode('fields');
                      setSelectedFieldId(null);
                      setSelectedFieldRect(null);
                    }}
                    onClick={() => {
                      setMenuMode('advanced');
                      setSelectedFieldId(null);
                      setSelectedFieldRect(null);
                    }}
                    data-testid="tracker-filter-advanced"
                  >
                    <MaterialSymbol icon="filter_alt" size={19} className="text-nim-muted" />
                    <span className="flex-1">Advanced filter</span>
                  </button>
                </div>

                <div className="max-h-[430px] overflow-y-auto p-2">
                  {matchingFields.map((field, index) => {
                    const startsGroup = index > 0
                      && (field.group ?? 'common') !== (matchingFields[index - 1].group ?? 'common');
                    const commandIndex = index + 1;
                    return (
                      <div
                        key={field.id}
                        className={startsGroup ? 'mt-2 border-t border-nim pt-2' : ''}
                      >
                        <button
                          type="button"
                          className={selectedFieldId === field.id || highlightedIndex === commandIndex
                            ? 'flex w-full items-center gap-3 rounded-md bg-nim-tertiary px-3 py-2 text-left text-[14px] text-nim'
                            : 'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-[14px] text-nim hover:bg-nim-tertiary'}
                          onMouseEnter={event => {
                            setHighlightedIndex(commandIndex);
                            openField(field, event.currentTarget.getBoundingClientRect());
                          }}
                          onClick={event => openField(field, event.currentTarget.getBoundingClientRect())}
                          data-testid={`tracker-filter-field-${field.id}`}
                        >
                          <MaterialSymbol icon={iconForField(field)} size={19} className="text-nim-muted" />
                          <span className="min-w-0 flex-1 truncate">{field.label}</span>
                          <MaterialSymbol icon="chevron_right" size={16} className="text-nim-faint" />
                        </button>
                      </div>
                    );
                  })}
                  {matchingFields.length === 0 && (
                    <div className="px-3 py-8 text-center text-[12px] text-nim-faint">
                      No matching fields
                    </div>
                  )}
                </div>
              </>
            )}

            {menuMode === 'advanced' && (
              <TrackerAdvancedFilterBuilder
                filterFields={filterFields}
                filters={filters}
                onFiltersChange={onFiltersChange}
                onBack={() => setMenuMode('fields')}
                onClose={() => setShowFilters(false)}
              />
            )}
          </div>
        )}

        {showFilters && menuMode === 'field' && selectedField && (
          <TrackerFilterValueMenu
            key={`${selectedField.id}:${JSON.stringify(
              clausesForField(filters, selectedField.id).map(clause => clause.value),
            )}`}
            field={selectedField}
            anchorRect={selectedFieldRect}
            placement="left"
            selectedValues={new Set(
              clausesForField(filters, selectedField.id).flatMap(clause =>
                Array.isArray(clause.value)
                  ? clause.value.map(String)
                  : clause.value === undefined ? [] : [String(clause.value)]),
            )}
            onSelect={applyQuickFilter}
            onClear={clausesForField(filters, selectedField.id).length > 0
              ? () => {
                onFiltersChange({
                  combinator: filters?.combinator ?? 'and',
                  clauses: (filters?.clauses ?? []).filter(
                    clause => clause.field !== selectedField.id,
                  ),
                });
                setMenuMode('fields');
                setSelectedFieldId(null);
                setSelectedFieldRect(null);
              }
              : undefined}
            onClose={() => {
              setMenuMode('fields');
              setSelectedFieldId(null);
              setSelectedFieldRect(null);
            }}
            dismissOnOutsideClick={false}
            menuRef={submenuRef}
          />
        )}
      </div>

      <div className="relative">
        <button
          ref={displayOptionsButtonRef}
          type="button"
          className={`inline-flex h-7 items-center gap-1 rounded border px-2 text-[11px] font-medium transition-colors ${
            showDisplayOptions
              ? 'border-nim-focus bg-nim-tertiary text-nim'
              : 'border-nim bg-nim-secondary text-nim-muted hover:bg-nim-tertiary hover:text-nim'
          }`}
          onClick={() => {
            setShowFilters(false);
            setShowDisplayOptions(open => !open);
          }}
          title="Display settings — view, grouping, ordering & columns"
          aria-label="Display settings"
          aria-expanded={showDisplayOptions}
          data-testid="tracker-view-display-options"
        >
          <MaterialSymbol icon="tune" size={14} />
          Display
        </button>
        {showDisplayOptions && (
          <DisplayOptionsPanel
            availableColumns={availableColumns}
            config={columnConfig}
            onConfigChange={onColumnConfigChange}
            onClose={() => setShowDisplayOptions(false)}
            anchorElement={displayOptionsButtonRef.current}
            viewModes={TRACKER_VIEW_MODE_OPTIONS}
            viewMode={viewMode}
            onViewModeChange={mode => setModeLayout({
              viewMode: normalizeTrackerViewMode(mode, viewMode),
            })}
            groupBy={groupBy}
            onGroupByChange={nextGroupBy => setModeLayout({ groupBy: nextGroupBy })}
            ordering={ordering}
            onOrderingChange={nextOrdering => setModeLayout({ ordering: nextOrdering })}
            showColumnProperties={showColumnControls}
          />
        )}
      </div>
    </div>
  );
}
