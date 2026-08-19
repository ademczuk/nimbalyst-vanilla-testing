// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, Provider } from 'jotai';
import type {
  TrackerColumnDef,
  TypeColumnConfig,
} from '@nimbalyst/runtime/plugins/TrackerPlugin';
import { trackerModeLayoutAtom } from '../../../store/atoms/trackers';
import { TrackerViewHeaderControls } from '../TrackerViewHeaderControls';

const columns = [
  {
    id: 'title',
    label: 'Title',
    width: 'auto',
    sortable: true,
    render: 'text',
    defaultVisible: true,
    builtin: true,
    editable: true,
    edit: 'text',
  },
  {
    id: 'status',
    label: 'Status',
    width: 120,
    sortable: true,
    render: 'badge',
    defaultVisible: true,
    builtin: true,
    editable: true,
    edit: 'select',
  },
  {
    id: 'priority',
    label: 'Priority',
    width: 100,
    sortable: true,
    render: 'badge',
    defaultVisible: false,
    builtin: true,
    editable: true,
    edit: 'select',
  },
] satisfies TrackerColumnDef[];

const columnConfig: TypeColumnConfig = {
  visibleColumns: ['title', 'status'],
  columnWidths: {},
};

const filterFields = [
  { id: 'title', label: 'Title', type: 'string' as const },
  {
    id: 'status',
    label: 'Status',
    type: 'select' as const,
    options: [
      { value: 'to-do', label: 'To do' },
      { value: 'done', label: 'Done' },
    ],
  },
  {
    id: 'priority',
    label: 'Priority',
    type: 'select' as const,
    options: [
      { value: 'high', label: 'High' },
      { value: 'low', label: 'Low' },
    ],
  },
  {
    id: 'tags',
    label: 'Tags',
    type: 'array' as const,
    options: [
      { value: 'ui', label: 'UI' },
      { value: 'backend', label: 'Backend' },
      { value: 'urgent', label: 'Urgent' },
    ],
  },
  { id: 'owner', label: 'Owner', type: 'user' as const },
  { id: 'updated', label: 'Updated', type: 'date' as const },
];

let store = createStore();

beforeEach(() => {
  store = createStore();
});

function renderControls(overrides: Partial<Parameters<typeof TrackerViewHeaderControls>[0]> = {}) {
  const onColumnConfigChange = vi.fn();
  const onFiltersChange = vi.fn();
  render(
    <Provider store={store}>
      <TrackerViewHeaderControls
        itemCount={42}
        availableColumns={columns}
        columnConfig={columnConfig}
        onColumnConfigChange={onColumnConfigChange}
        showColumnControls
        filterFields={filterFields}
        filters={null}
        onFiltersChange={onFiltersChange}
        statusScope="open"
        onStatusScopeChange={vi.fn()}
        {...overrides}
      />
    </Provider>,
  );
  return { onColumnConfigChange, onFiltersChange };
}

/** Pick an option from one of the panel's floating selects. */
function chooseDisplaySetting(testId: string, optionLabel: string): void {
  fireEvent.click(within(screen.getByTestId(testId)).getByRole('button'));
  const dropdown = document.querySelector('.custom-select-dropdown');
  const option = Array.from(dropdown?.querySelectorAll('button') ?? [])
    .find(candidate => candidate.textContent === optionLabel);
  if (!option) throw new Error(`No "${optionLabel}" option in ${testId}`);
  fireEvent.click(option);
}

describe('TrackerViewHeaderControls', () => {
  it('keeps count, filters, and display options in one shared header control group', () => {
    renderControls();

    expect(screen.getByTestId('tracker-view-item-count').textContent).toBe('42 items');
    screen.getByTestId('tracker-view-filter-button');
    screen.getByTestId('tracker-view-display-options');
  });

  it('builds multiple field-aware clauses with AND/OR semantics', () => {
    const { onFiltersChange } = renderControls();
    fireEvent.click(screen.getByTestId('tracker-view-filter-button'));
    fireEvent.click(screen.getByTestId('tracker-filter-advanced'));

    fireEvent.change(screen.getByTestId('tracker-filter-builder-field-0'), {
      target: { value: 'status' },
    });
    fireEvent.change(screen.getByTestId('tracker-filter-builder-value-0'), {
      target: { value: 'done' },
    });
    fireEvent.click(screen.getByTestId('tracker-filter-builder-add'));
    fireEvent.change(screen.getByTestId('tracker-filter-builder-field-1'), {
      target: { value: 'priority' },
    });
    fireEvent.change(screen.getByTestId('tracker-filter-builder-value-1'), {
      target: { value: 'high' },
    });
    fireEvent.change(screen.getByTestId('tracker-filter-builder-combinator'), {
      target: { value: 'or' },
    });
    fireEvent.click(screen.getByTestId('tracker-filter-builder-apply'));

    expect(onFiltersChange).toHaveBeenCalledWith({
      combinator: 'or',
      clauses: [
        { field: 'status', op: '=', value: 'done' },
        { field: 'priority', op: '=', value: 'high' },
      ],
    });
  });

  it('starts as a searchable field command menu and applies a quick field filter', () => {
    const { onFiltersChange } = renderControls();
    fireEvent.click(screen.getByTestId('tracker-view-filter-button'));

    screen.getByPlaceholderText('Add filter…');
    screen.getByTestId('tracker-filter-advanced');
    fireEvent.change(screen.getByTestId('tracker-filter-command-search'), {
      target: { value: 'status' },
    });
    screen.getByTestId('tracker-filter-field-status');
    expect(screen.queryByTestId('tracker-filter-field-priority')).toBeNull();

    fireEvent.click(screen.getByTestId('tracker-filter-field-status'));
    screen.getByTestId('tracker-filter-value-submenu');
    screen.getByTestId('tracker-filter-field-status');
    fireEvent.click(screen.getByTestId('tracker-filter-option-done'));

    expect(onFiltersChange).toHaveBeenCalledWith({
      combinator: 'and',
      clauses: [{ field: 'status', op: '=', value: 'done' }],
    });
  });

  it('uses checkbox multi-select for collection fields such as tags', () => {
    const { onFiltersChange } = renderControls();
    fireEvent.click(screen.getByTestId('tracker-view-filter-button'));
    fireEvent.click(screen.getByTestId('tracker-filter-field-tags'));

    const ui = screen.getByTestId('tracker-filter-option-ui');
    const backend = screen.getByTestId('tracker-filter-option-backend');
    expect(ui.getAttribute('role')).toBe('checkbox');
    expect(ui.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(ui);
    fireEvent.click(backend);

    expect(onFiltersChange).not.toHaveBeenCalled();
    expect(ui.getAttribute('aria-checked')).toBe('true');
    expect(backend.getAttribute('aria-checked')).toBe('true');
    screen.getByTestId('tracker-filter-value-submenu');

    fireEvent.click(screen.getByTestId('tracker-filter-apply-multiple'));

    expect(onFiltersChange).toHaveBeenCalledWith({
      combinator: 'and',
      clauses: [{ field: 'tags', op: 'in', value: ['ui', 'backend'] }],
    });
  });

  it('keeps a value submenu open when field option counts refresh', () => {
    const onColumnConfigChange = vi.fn();
    const onFiltersChange = vi.fn();
    const sharedProps = {
      itemCount: 42,
      availableColumns: columns,
      columnConfig,
      onColumnConfigChange,
      showColumnControls: true,
      filters: null,
      onFiltersChange,
      statusScope: 'open' as const,
      onStatusScopeChange: vi.fn(),
    };
    const { rerender } = render(
      <TrackerViewHeaderControls {...sharedProps} filterFields={filterFields} />,
    );
    fireEvent.click(screen.getByTestId('tracker-view-filter-button'));
    fireEvent.click(screen.getByTestId('tracker-filter-field-tags'));
    screen.getByTestId('tracker-filter-value-submenu');

    rerender(
      <TrackerViewHeaderControls
        {...sharedProps}
        filterFields={filterFields.map(field => ({
          ...field,
          options: field.options?.map(option => ({ ...option, count: 2 })),
        }))}
      />,
    );

    screen.getByTestId('tracker-filter-value-submenu');
    screen.getByTestId('tracker-filter-apply-multiple');
  });

  it('reopens a collection filter with its values selected and replaces it', () => {
    const { onFiltersChange } = renderControls({
      filters: {
        combinator: 'and',
        clauses: [{ field: 'tags', op: 'in', value: ['ui', 'backend'] }],
      },
    });
    fireEvent.click(screen.getByTestId('tracker-view-filter-button'));
    fireEvent.click(screen.getByTestId('tracker-filter-field-tags'));

    expect(screen.getByTestId('tracker-filter-option-ui').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('tracker-filter-option-backend').getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByTestId('tracker-filter-option-ui'));
    fireEvent.click(screen.getByTestId('tracker-filter-option-urgent'));
    fireEvent.click(screen.getByTestId('tracker-filter-apply-multiple'));

    expect(onFiltersChange).toHaveBeenLastCalledWith({
      combinator: 'and',
      clauses: [{ field: 'tags', op: 'in', value: ['backend', 'urgent'] }],
    });
  });

  it('supports keyboard drill-in and removing active filters from the command menu', () => {
    const { onFiltersChange } = renderControls({
      filters: {
        combinator: 'and',
        clauses: [{ field: 'status', op: '=', value: 'done' }],
      },
    });
    fireEvent.click(screen.getByTestId('tracker-view-filter-button'));

    screen.getByTestId('tracker-filter-active-list');
    fireEvent.keyDown(screen.getByTestId('tracker-filter-command-search'), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByTestId('tracker-filter-command-search'), { key: 'Enter' });
    screen.getByTestId('tracker-filter-value-submenu');
    screen.getByTestId('tracker-filter-builder');

    fireEvent.click(screen.getByLabelText('Remove Status filter'));
    expect(onFiltersChange).toHaveBeenCalledWith({ combinator: 'and', clauses: [] });
  });

  it('applies current-user and arbitrary relative-day filters from the field menu', () => {
    const { onFiltersChange } = renderControls();
    fireEvent.click(screen.getByTestId('tracker-view-filter-button'));
    fireEvent.click(screen.getByTestId('tracker-filter-field-owner'));
    fireEvent.click(screen.getByTestId('tracker-filter-relative-current-user'));

    expect(onFiltersChange).toHaveBeenLastCalledWith({
      combinator: 'and',
      clauses: [{ field: 'owner', op: 'is-current-user' }],
    });

    fireEvent.click(screen.getByTestId('tracker-view-filter-button'));
    fireEvent.click(screen.getByTestId('tracker-filter-field-updated'));
    fireEvent.change(screen.getByTestId('tracker-filter-relative-days'), {
      target: { value: '14' },
    });
    fireEvent.click(screen.getByTestId('tracker-filter-relative-in-last'));

    expect(onFiltersChange).toHaveBeenLastCalledWith({
      combinator: 'and',
      clauses: [{ field: 'updated', op: 'in-last', value: 14 }],
    });
  });

  it('keeps the field menu open beside a searchable value submenu with counts', () => {
    renderControls({
      filterFields: [
        {
          id: 'status',
          label: 'Status',
          type: 'select',
          options: [
            { value: 'done', label: 'Done', count: 2, color: '#22c55e' },
            { value: 'blocked', label: 'Blocked', count: 0, color: '#ef4444' },
          ],
        },
      ],
    });
    fireEvent.click(screen.getByTestId('tracker-view-filter-button'));
    fireEvent.mouseEnter(screen.getByTestId('tracker-filter-field-status'));

    screen.getByTestId('tracker-filter-builder');
    screen.getByTestId('tracker-filter-value-submenu');
    screen.getByText('2 issues');
    screen.getByText('1 option not matching any issues');

    fireEvent.change(screen.getByTestId('tracker-filter-option-search'), {
      target: { value: 'don' },
    });
    screen.getByTestId('tracker-filter-option-done');
  });

  it('uses the same display-options panel for column visibility', () => {
    const { onColumnConfigChange } = renderControls();
    fireEvent.click(screen.getByTestId('tracker-view-display-options'));
    screen.getByTestId('tracker-display-options-panel');

    fireEvent.click(within(screen.getByTestId('tracker-display-options-columns'))
      .getByText('Priority'));
    expect(onColumnConfigChange).toHaveBeenCalledWith({
      visibleColumns: ['title', 'status', 'priority'],
      columnWidths: {},
    });
  });

  it('keeps a long display-options panel within the viewport and scrollable', async () => {
    const manyColumns = [
      ...columns,
      ...Array.from({ length: 20 }, (_, index) => ({
        ...columns[0],
        id: `custom-${index}`,
        label: `Custom ${index}`,
        defaultVisible: false,
        builtin: false,
      })),
    ] satisfies TrackerColumnDef[];

    renderControls({ availableColumns: manyColumns });
    fireEvent.click(screen.getByTestId('tracker-view-display-options'));

    const panel = screen.getByTestId('tracker-display-options-panel');
    await waitFor(() => {
      expect(panel.style.position).toBe('fixed');
      expect(panel.style.maxHeight).toMatch(/^\d+(?:\.\d+)?px$/);
    });
    expect(screen.getByTestId('tracker-display-options-scroll-region').className)
      .toContain('overflow-y-auto');
  });

  it('gives the starred field a star icon and finds it by its stored id', () => {
    renderControls({
      filterFields: [
        ...filterFields,
        { id: 'favorite', label: 'Starred', type: 'boolean' as const },
      ],
    });
    fireEvent.click(screen.getByTestId('tracker-view-filter-button'));

    // Typing the persisted id still finds the renamed field.
    fireEvent.change(screen.getByTestId('tracker-filter-command-search'), {
      target: { value: 'favorite' },
    });
    const row = screen.getByTestId('tracker-filter-field-favorite');
    expect(row.textContent).toContain('Starred');
    expect(row.querySelector('.material-symbols-outlined')?.textContent).toBe('star');
    expect(screen.queryByTestId('tracker-filter-field-status')).toBeNull();
  });

  it('names the active filter value the way the field does', () => {
    renderControls({
      filterFields: [
        ...filterFields,
        {
          id: 'favorite',
          label: 'Starred',
          type: 'boolean' as const,
          options: [
            { value: 'true', label: 'Yes' },
            { value: 'false', label: 'No' },
          ],
        },
      ],
      filters: { combinator: 'and', clauses: [{ field: 'favorite', op: '=', value: true }] },
    });
    fireEvent.click(screen.getByTestId('tracker-view-filter-button'));

    expect(screen.getByTestId('tracker-filter-active-list').textContent)
      .toContain('Starred is Yes');
  });

  it('keeps Display Settings reachable from views that have no table columns', () => {
    renderControls({ showColumnControls: false });
    fireEvent.click(screen.getByTestId('tracker-view-display-options'));

    // The board has no column properties to configure, but view mode,
    // grouping, and ordering still have to be reachable from it.
    screen.getByTestId('tracker-display-view-settings');
    expect(screen.queryByTestId('tracker-display-options-columns')).toBeNull();
  });

  it('writes the chosen view mode, column axis, and ordering onto the view state', () => {
    renderControls();
    fireEvent.click(screen.getByTestId('tracker-view-display-options'));

    chooseDisplaySetting('tracker-display-group-by', 'Milestone');
    expect(store.get(trackerModeLayoutAtom).groupBy).toBe('milestone');

    chooseDisplaySetting('tracker-display-ordering', 'Priority');
    expect(store.get(trackerModeLayoutAtom).ordering).toBe('priority');

    // Timeline is selectable and persists ahead of the view that draws it.
    fireEvent.click(screen.getByTestId('tracker-display-view-mode-timeline'));
    expect(store.get(trackerModeLayoutAtom).viewMode).toBe('timeline');
  });

  it('opens filter management when an active filter pill requests it', () => {
    renderControls({ openFiltersToken: 1 });

    screen.getByTestId('tracker-filter-builder');
  });

});
