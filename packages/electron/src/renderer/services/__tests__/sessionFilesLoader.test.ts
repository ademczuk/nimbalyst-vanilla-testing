// @vitest-environment node
/**
 * NIM-3085: the per-session fan-out is invisible in the rendered output — the
 * files look identical whether they arrived in 1 IPC call or 40. These tests
 * pin the CALL COUNT, which is the thing that actually regressed.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  loadSessionFiles,
  loadSessionFilesResult,
  __resetSessionFilesLoaderForTests,
} from '../sessionFilesLoader';

const invoke = vi.fn();

function link(sessionId: string, filePath: string, linkType = 'edited') {
  return { id: `${sessionId}:${filePath}`, sessionId, workspaceId: 'w', filePath, linkType, timestamp: 1 };
}

beforeEach(() => {
  invoke.mockReset();
  __resetSessionFilesLoaderForTests();
  (globalThis as any).window = { electronAPI: { invoke } };
});

describe('sessionFilesLoader', () => {
  it('collapses concurrent per-session requests into ONE batched IPC call', async () => {
    const ids = Array.from({ length: 40 }, (_, i) => `s${i}`);
    invoke.mockResolvedValue({
      success: true,
      files: ids.map((id) => link(id, `${id}.ts`)),
    });

    const results = await Promise.all(ids.map((id) => loadSessionFiles(id, 'edited')));

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('session-files:get-by-sessions', ids, 'edited');
    // Each caller still gets only its own session's rows.
    expect(results.map((r) => r.map((f) => f.filePath))).toEqual(ids.map((id) => [`${id}.ts`]));
  });

  it('deduplicates repeated requests for the same session within a window', async () => {
    invoke.mockResolvedValue({ success: true, files: [link('s1', 'a.ts')] });

    const results = await Promise.all([
      loadSessionFiles('s1', 'edited'),
      loadSessionFiles('s1', 'edited'),
      loadSessionFiles('s1', 'edited'),
    ]);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('session-files:get-by-sessions', ['s1'], 'edited');
    for (const r of results) expect(r.map((f) => f.filePath)).toEqual(['a.ts']);
  });

  it('batches per linkType, so read+edited for one session is 2 calls not 2N', async () => {
    invoke.mockImplementation(async (_ch: string, sessionIds: string[], linkType: string) => ({
      success: true,
      files: sessionIds.map((id) => link(id, `${id}.${linkType}.ts`, linkType)),
    }));

    const ids = ['s1', 's2', 's3'];
    await Promise.all([
      ...ids.map((id) => loadSessionFiles(id, 'read')),
      ...ids.map((id) => loadSessionFiles(id, 'edited')),
    ]);

    expect(invoke).toHaveBeenCalledTimes(2);
    const linkTypes = invoke.mock.calls.map((c) => c[2]).sort();
    expect(linkTypes).toEqual(['edited', 'read']);
  });

  it('caps ids per query so a big workstream cannot build one monster IN list', async () => {
    // 450 sessions in one tick (FilesEditedSidebar loops over every child).
    const ids = Array.from({ length: 450 }, (_, i) => `s${i}`);
    invoke.mockImplementation(async (_ch: string, sessionIds: string[]) => ({
      success: true,
      files: sessionIds.map((id) => link(id, `${id}.ts`)),
    }));

    const results = await Promise.all(ids.map((id) => loadSessionFiles(id, 'edited')));

    // 450 sessions -> 3 chunks of <=200, NOT 450 calls and NOT 1 giant call.
    expect(invoke).toHaveBeenCalledTimes(3);
    for (const call of invoke.mock.calls) {
      expect(call[1].length).toBeLessThanOrEqual(200);
    }
    // Every caller still gets exactly its own row back.
    expect(results.map((r) => r.map((f) => f.filePath))).toEqual(ids.map((id) => [`${id}.ts`]));
  });

  it('resolves a session with no links to an empty array, not a rejection', async () => {
    // s2 is absent from the response entirely — a session with zero file links.
    invoke.mockResolvedValue({ success: true, files: [link('s1', 'a.ts')] });

    const [a, b] = await Promise.all([
      loadSessionFiles('s1', 'edited'),
      loadSessionFiles('s2', 'edited'),
    ]);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(a.map((f) => f.filePath)).toEqual(['a.ts']);
    expect(b).toEqual([]);
  });

  it('surfaces an IPC rejection as success:false through the result wrapper', async () => {
    invoke.mockRejectedValue(new Error('worker gone'));

    const result = await loadSessionFilesResult('s1', 'edited');

    expect(result).toEqual({ success: false, files: [] });
  });

  it('starts a fresh batch after the previous one flushes', async () => {
    invoke.mockResolvedValue({ success: true, files: [link('s1', 'a.ts')] });

    await loadSessionFiles('s1', 'edited');
    await loadSessionFiles('s1', 'edited');

    // Sequential (not concurrent) requests cannot share a window, so this is
    // 2 calls — the batching claim is about concurrent fan-out, not caching.
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
