// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { extractRemotePresences, resolveCellSection } from '../presence';
import { LocalPresenceTracker } from '../localPresence';

type RawState = {
  user?: { id?: unknown; name?: unknown; color?: unknown };
  selectedCell?: unknown;
  editingCell?: unknown;
};

function states(entries: Array<[number, RawState]>): Map<number, RawState> {
  return new Map(entries);
}

const user = (id: string, name = 'Ada', color = '#ff0000') => ({ id, name, color });

describe('extractRemotePresences', () => {
  it('excludes the local client', () => {
    const s = states([
      [1, { user: user('local'), selectedCell: { row: 0, col: 0 } }],
      [2, { user: user('remote'), selectedCell: { row: 3, col: 4 } }],
    ]);
    const out = extractRemotePresences(s, 1);
    expect(out).toHaveLength(1);
    expect(out[0].userId).toBe('remote');
    expect(out[0].cell).toEqual({ row: 3, col: 4 });
  });

  it('prefers editingCell over selectedCell and flags editing', () => {
    const s = states([
      [2, { user: user('r'), selectedCell: { row: 1, col: 1 }, editingCell: { row: 5, col: 2 } }],
    ]);
    const out = extractRemotePresences(s, 1);
    expect(out[0].cell).toEqual({ row: 5, col: 2 });
    expect(out[0].editing).toBe(true);
  });

  it('reports editing=false when only a selection exists', () => {
    const s = states([[2, { user: user('r'), selectedCell: { row: 1, col: 1 } }]]);
    const out = extractRemotePresences(s, 1);
    expect(out[0].editing).toBe(false);
  });

  it('drops states without a usable user id', () => {
    const s = states([
      [2, { selectedCell: { row: 1, col: 1 } }],
      [3, { user: { name: 'x' }, selectedCell: { row: 1, col: 1 } }],
    ]);
    expect(extractRemotePresences(s, 1)).toHaveLength(0);
  });

  it('drops states with no cell at all', () => {
    const s = states([[2, { user: user('r') }]]);
    expect(extractRemotePresences(s, 1)).toHaveLength(0);
  });

  it('drops malformed cells (non-numeric / negative) without throwing', () => {
    const s = states([
      [2, { user: user('a'), selectedCell: { row: 'x', col: 1 } }],
      [3, { user: user('b'), selectedCell: { row: -1, col: 0 } }],
      [4, { user: user('c'), editingCell: null, selectedCell: { row: 2, col: 3 } }],
    ]);
    const out = extractRemotePresences(s, 1);
    expect(out).toHaveLength(1);
    expect(out[0].userId).toBe('c');
    expect(out[0].cell).toEqual({ row: 2, col: 3 });
  });

  it('falls back to defaults for missing name/color', () => {
    const s = states([[2, { user: { id: 'r' }, selectedCell: { row: 0, col: 0 } }]]);
    const out = extractRemotePresences(s, 1);
    expect(out[0].name).toBe('Collaborator');
    expect(out[0].color).toBe('#888888');
  });
});

describe('resolveCellSection', () => {
  it('maps data rows into the scrolling section offset by header count', () => {
    expect(resolveCellSection(3, 1)).toEqual({ rowType: 'rgRow', gridRow: 2 });
  });

  it('maps header rows into the pinned-top section keeping their index', () => {
    expect(resolveCellSection(0, 2)).toEqual({ rowType: 'rowPinStart', gridRow: 0 });
    expect(resolveCellSection(1, 2)).toEqual({ rowType: 'rowPinStart', gridRow: 1 });
  });

  it('treats the first data row correctly at the header boundary', () => {
    expect(resolveCellSection(2, 2)).toEqual({ rowType: 'rgRow', gridRow: 0 });
  });

  it('with no header rows, all rows are in the scrolling section', () => {
    expect(resolveCellSection(0, 0)).toEqual({ rowType: 'rgRow', gridRow: 0 });
  });
});

describe('LocalPresenceTracker', () => {
  it('keeps the editing cell when a selection event lands mid-edit', () => {
    // The cross-host defect: RevoGrid emitted a focus event 56ms after
    // `beforeeditstart`, the selection publish asserted `editingCell: null`,
    // and DocumentSync's 2Hz coalescing meant the editing frame in between
    // never reached the wire -- so a peer saw a selection box with no label.
    const tracker = new LocalPresenceTracker();
    const { patch } = tracker.beginEdit({ row: 3, col: 1 });
    expect(patch).toEqual({ editingCell: { row: 3, col: 1 } });

    expect(tracker.select({ row: 2, col: 1 })).toEqual({
      selectedCell: { row: 2, col: 1 },
      editingCell: { row: 3, col: 1 },
    });
  });

  it('reports no editing cell on a selection while nothing is being edited', () => {
    const tracker = new LocalPresenceTracker();
    expect(tracker.select({ row: 1, col: 0 })).toEqual({
      selectedCell: { row: 1, col: 0 },
      editingCell: null,
    });
  });

  it('clears on close and then has nothing left to publish', () => {
    const tracker = new LocalPresenceTracker();
    tracker.beginEdit({ row: 3, col: 1 });
    expect(tracker.endEdit()).toEqual({ editingCell: null });
    expect(tracker.isEditing()).toBe(false);
    // A commit followed by the editor's own disconnect must not double-publish.
    expect(tracker.endEdit()).toBeNull();
  });

  it('ignores a stale editor disconnecting after the next one opened', () => {
    const tracker = new LocalPresenceTracker();
    const first = tracker.beginEdit({ row: 3, col: 1 }).session;
    const second = tracker.beginEdit({ row: 4, col: 2 }).session;

    expect(tracker.endEdit(first)).toBeNull();
    expect(tracker.select(null)).toEqual({
      selectedCell: null,
      editingCell: { row: 4, col: 2 },
    });
    expect(tracker.endEdit(second)).toEqual({ editingCell: null });
  });
});
