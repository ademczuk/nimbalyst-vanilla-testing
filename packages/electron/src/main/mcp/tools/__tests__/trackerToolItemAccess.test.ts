// @vitest-environment node
/**
 * `tracker_items` holds every workspace's rows in one table, and its unique
 * index is per `(workspace, key)` -- so a reference resolved without a
 * workspace can match rows from projects the caller never mentioned. Team keys
 * survive that because the room arbitrates them across the org. Local numbers
 * have no arbiter: every project on the machine has a `.4`. These pin that a
 * dotted reference cannot resolve without being told which project it belongs
 * to.
 */

import { describe, expect, it } from 'vitest';
import { resolveTrackerRowByReference } from '../trackerToolItemAccess';

interface Row {
  id: string;
  workspace: string;
  local_key: string | null;
  issue_key: string | null;
}

function fakeDb(rows: Row[]) {
  return {
    calls: [] as string[],
    async query<T = any>(sql: string, params: any[] = []): Promise<{ rows: T[] }> {
      this.calls.push(sql);
      if (sql.includes('local_key = $1')) {
        const [localKey, workspace] = params as [string, string];
        return { rows: rows.filter((r) => r.local_key === localKey && r.workspace === workspace) as T[] };
      }
      if (sql.includes('id = $1 OR issue_key = $1')) {
        const [reference, workspace] = params as [string, string | undefined];
        return {
          rows: rows.filter(
            (r) =>
              (r.id === reference || r.issue_key === reference)
              && (workspace === undefined || r.workspace === workspace),
          ) as T[],
        };
      }
      return { rows: [] };
    },
  };
}

const ROWS: Row[] = [
  { id: 'a', workspace: '/src/app', local_key: 'NIM.4', issue_key: null },
  { id: 'b', workspace: '/src/site', local_key: 'NIM.4', issue_key: null },
  { id: 'c', workspace: '/src/app', local_key: 'NIM.9', issue_key: 'NIM-212' },
];

describe('resolveTrackerRowByReference', () => {
  it('resolves a local number inside the project that issued it', async () => {
    const db = fakeDb(ROWS);
    await expect(resolveTrackerRowByReference(db, 'NIM.4', '/src/app')).resolves.toMatchObject({ id: 'a' });
    await expect(resolveTrackerRowByReference(db, 'NIM.4', '/src/site')).resolves.toMatchObject({ id: 'b' });
  });

  it('refuses a local number when no project is named', async () => {
    const db = fakeDb(ROWS);
    // Two rows carry NIM.4. Returning either one is the bug, so return neither.
    await expect(resolveTrackerRowByReference(db, 'NIM.4')).resolves.toBeNull();
  });

  it('never looks up a local number in the issue_key lane', async () => {
    const db = fakeDb(ROWS);
    await resolveTrackerRowByReference(db, 'NIM.4', '/src/app');

    expect(db.calls.some((sql) => sql.includes('id = $1 OR issue_key = $1'))).toBe(false);
  });

  it('still resolves team keys, including for an item that also has a local number', async () => {
    const db = fakeDb(ROWS);
    await expect(resolveTrackerRowByReference(db, 'NIM-212', '/src/app')).resolves.toMatchObject({ id: 'c' });
  });

  it('keeps refusing recycled LC keys', async () => {
    const db = fakeDb(ROWS);
    await expect(resolveTrackerRowByReference(db, 'LC-7', '/src/app')).resolves.toBeNull();
  });
});
