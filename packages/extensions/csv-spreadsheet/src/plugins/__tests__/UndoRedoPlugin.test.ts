// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

// Only `BasePlugin` is needed at runtime; everything else the plugin imports
// from this package is type-only. A factory (no `importOriginal` spread) keeps
// the real RevoGrid module -- and its whole Stencil component tree -- out of
// the graph, which is what lets this file run in the node environment.
vi.mock('@revolist/revogrid', () => ({
  BasePlugin: class {
    revogrid: MockGrid;
    providers: MockProviders;
    constructor(revogrid: MockGrid, providers: MockProviders) {
      this.revogrid = revogrid;
      this.providers = providers;
    }
    addEventListener(name: string, callback: (e: unknown) => void) {
      this.revogrid.addEventListener(name, callback);
    }
    destroy() {}
  },
}));

import { UndoRedoPlugin } from '../UndoRedoPlugin';

type Row = Record<string, unknown>;
type Range = { x: number; y: number; x1: number; y1: number };

interface MockGrid {
  addEventListener(name: string, callback: (e: unknown) => void): void;
  setDataAt: ReturnType<typeof vi.fn>;
  setCellsFocus: ReturnType<typeof vi.fn>;
}
interface MockProviders {
  selection: { focused: { x: number; y: number } | null; selectedRange: Range | null };
  data: { getModel(index: number): Row };
  column: { getColumn(index: number): { prop: string } | undefined };
}

/** Columns A/B/C over two rows -- enough to select a sub-range that excludes A1. */
function createHarness(options: { range?: Range | null } = {}) {
  const rows: Row[] = [
    { A: 'a0', B: 'b0', C: 'c0' },
    { A: 'a1', B: 'b1', C: 'c1' },
  ];
  const columns = [{ prop: 'A' }, { prop: 'B' }, { prop: 'C' }];
  const handlers = new Map<string, (e: unknown) => void>();

  const grid: MockGrid = {
    addEventListener: (name, callback) => void handlers.set(name, callback),
    setDataAt: vi.fn(),
    setCellsFocus: vi.fn(),
  };
  const providers: MockProviders = {
    selection: {
      focused: { x: 1, y: 0 },
      selectedRange: options.range === undefined ? { x: 1, y: 0, x1: 2, y1: 1 } : options.range,
    },
    data: { getModel: (index) => rows[index] },
    column: { getColumn: (index) => columns[index] },
  };

  const plugin = new UndoRedoPlugin(
    grid as unknown as HTMLRevoGridElement,
    providers as never
  );

  return {
    plugin,
    grid,
    rows,
    emit: (name: string, detail: unknown) => handlers.get(name)?.({ detail }),
    /** The cells `undo()` wrote back, order-independent. */
    writes: () =>
      grid.setDataAt.mock.calls.map(([c]) => ({ row: c.row, col: c.col, val: c.val })),
  };
}

describe('UndoRedoPlugin cut handling', () => {
  // RevoGrid types `clearregion` as EventEmitter<DataTransfer> and emits the raw
  // clipboard object -- no range, no data. The old handler destructured a shape
  // that never arrives and threw on `range.y1`. Values must come from the grid,
  // snapshotted on `beforecut` while the cells still hold them.
  it('records the pre-clear values when clearregion carries only a DataTransfer', async () => {
    const { plugin, emit, writes } = createHarness();

    emit('beforecut', { event: {} });
    emit('clearregion', { types: [], getData: () => '' });

    expect(plugin.canUndo).toBe(true);
    await plugin.undo();

    expect(writes()).toHaveLength(4);
    expect(writes()).toEqual(
      expect.arrayContaining([
        { row: 0, col: 1, val: 'b0' },
        { row: 0, col: 2, val: 'c0' },
        { row: 1, col: 1, val: 'b1' },
        { row: 1, col: 2, val: 'c1' },
      ])
    );
  });

  // A cut that RevoGrid aborts (readonly, or beforecut defaultPrevented) emits
  // no clearregion, so a stale snapshot must never be replayed by a later one.
  it('is a no-op when clearregion arrives without a preceding beforecut', () => {
    const { plugin, emit } = createHarness();

    expect(() => emit('clearregion', { types: [], getData: () => '' })).not.toThrow();
    expect(plugin.canUndo).toBe(false);
  });
});

describe('UndoRedoPlugin range edits', () => {
  // Deleting a multi-cell range routes through autoFillService.onRangeApply,
  // which emits the BeforeRangeSaveDataDetails half of the AfterEditEvent union.
  // It has no rowIndex/colIndex/prop, so the old unconditional cast fell back to
  // (0, 0, '') and recorded one bogus entry pointing at A1.
  //
  // The emit order here mirrors revo-grid's onRangeEdit: beforerangeedit, then
  // setRangeData, then afteredit. Mutating `rows` in between is the point --
  // `detail.models` holds live row references, so reading old values at
  // afteredit time yields the already-cleared values. Only a snapshot taken at
  // beforerangeedit survives, and this test fails if that regresses.
  it('records one change per cell for a range delete, and nothing at A1', async () => {
    const { plugin, emit, writes, rows } = createHarness();

    const detail = {
      data: { 0: { B: '', C: '' }, 1: { B: '', C: '' } },
      models: {
        0: { A: 'a0', B: 'b0', C: 'c0' },
        1: { A: 'a1', B: 'b1', C: 'c1' },
      },
      type: 'rgRow',
      newRange: { x: 1, y: 0, x1: 2, y1: 1 },
      oldRange: { x: 1, y: 0, x1: 2, y1: 1 },
    };

    emit('beforerangeedit', detail);
    // setRangeData lands before afteredit fires.
    rows[0].B = '';
    rows[0].C = '';
    rows[1].B = '';
    rows[1].C = '';
    detail.models[0].B = '';
    detail.models[0].C = '';
    detail.models[1].B = '';
    detail.models[1].C = '';
    emit('afteredit', detail);

    await plugin.undo();

    expect(writes()).toHaveLength(4);
    expect(writes()).toEqual(
      expect.arrayContaining([
        { row: 0, col: 1, val: 'b0' },
        { row: 0, col: 2, val: 'c0' },
        { row: 1, col: 1, val: 'b1' },
        { row: 1, col: 2, val: 'c1' },
      ])
    );
    // The regression guard: column A is outside the deleted range and must
    // never be written, however the payload is interpreted.
    expect(writes().some((w) => w.col === 0)).toBe(false);
  });
});
