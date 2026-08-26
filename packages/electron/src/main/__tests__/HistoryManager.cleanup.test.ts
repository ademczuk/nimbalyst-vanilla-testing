// @vitest-environment node
/**
 * History retention used to find its deletions with a ROW_NUMBER() window over
 * the WHOLE document_history table. That table stores full file content (472MB
 * across 46,350 rows on one install), so the scan dragged every blob off disk
 * to identify 487 deletable rows across 5 files -- 5,965ms in a single call on
 * the single-lane SQLite worker, at startup, blocking everything behind it.
 *
 * These pin the cheap shape: find the few files over the limit first, then
 * delete only within those. The retention rule itself is unchanged -- newest
 * `maxSnapshots` per file survive -- and that equivalence is what the first
 * two cases assert.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const query = vi.fn();

vi.mock('../database/PGLiteDatabaseWorker', () => ({
  database: {
    isInitialized: () => true,
    initialize: vi.fn(),
    query: (...args: unknown[]) => query(...args),
  },
}));
vi.mock('../utils/logger', () => ({
  logger: { main: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } },
}));
vi.mock('electron', () => ({
  app: { getPath: () => '/mock', isPackaged: false },
  BrowserWindow: { getAllWindows: () => [] },
}));

const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim().toLowerCase();
const sqlCalls = () => query.mock.calls.map(c => normalize(String(c[0])));

describe('HistoryManager.cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    query.mockResolvedValue({ rows: [] });
  });

  it('does no per-file work when no file exceeds the snapshot limit', async () => {
    const { HistoryManager } = await import('../HistoryManager');
    // The over-limit lookup returns nothing -- the common case.
    query.mockResolvedValue({ rows: [] });

    await new HistoryManager().cleanup();

    const calls = sqlCalls();
    // Never scans the whole table to build a window.
    expect(calls.some(s => s.includes('row_number()'))).toBe(false);
    // Age delete plus the over-limit lookup, and nothing more.
    expect(calls.filter(s => s.startsWith('delete'))).toHaveLength(1);
  });

  it('deletes only within files that are over the limit, keeping the newest', async () => {
    const { HistoryManager } = await import('../HistoryManager');
    query.mockImplementation(async (sql: string) => {
      if (normalize(sql).includes('group by file_path')) {
        return { rows: [{ file_path: '/a.md' }, { file_path: '/b.md' }] };
      }
      return { rows: [] };
    });

    await new HistoryManager().cleanup();

    const perFileDeletes = query.mock.calls.filter(
      c => normalize(String(c[0])).startsWith('delete') && normalize(String(c[0])).includes('file_path')
    );
    expect(perFileDeletes).toHaveLength(2);

    // Retention rule preserved: keep the newest N for that file, drop the rest.
    const [sql, params] = perFileDeletes[0];
    const s = normalize(String(sql));
    expect(s).toContain('order by timestamp desc');
    expect(s).toContain('limit');
    expect(params).toContain('/a.md');
    expect(params).toContain(250);
  });

  it('still prunes by age', async () => {
    const { HistoryManager } = await import('../HistoryManager');
    await new HistoryManager().cleanup();

    const ageDelete = sqlCalls().find(s => s.startsWith('delete') && s.includes('timestamp <'));
    expect(ageDelete).toBeDefined();
  });

  it('survives a failure without throwing', async () => {
    const { HistoryManager } = await import('../HistoryManager');
    query.mockRejectedValue(new Error('worker busy'));

    await expect(new HistoryManager().cleanup()).resolves.toBeUndefined();
  });
});
