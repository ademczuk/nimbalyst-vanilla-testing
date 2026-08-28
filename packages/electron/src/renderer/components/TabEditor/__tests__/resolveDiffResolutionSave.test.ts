// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { resolveDiffResolutionSave } from '../resolveDiffResolutionSave';

const PRE_AI = '# before\n';
const AGENT_WROTE = '# after\n';

/**
 * A stand-in for DocumentModel's diff state: readable until it is cleared,
 * which is exactly the sequencing that broke.
 */
function diffModel(newContent: string) {
  let state: { newContent: string } | null = { newContent };
  return {
    read: () => state?.newContent,
    clear: () => {
      state = null;
    },
  };
}

describe('resolveDiffResolutionSave', () => {
  it('writes against the agent content even when the same call clears diff state', async () => {
    const model = diffModel(AGENT_WROTE);
    const saveFile = vi.fn().mockResolvedValue({ success: true, filePath: '/a.md' });

    const outcome = await resolveDiffResolutionSave(AGENT_WROTE, {
      readDiffBaseline: model.read,
      fallbackBaseline: PRE_AI,
      clearDiffState: model.clear,
      saveFile,
    });

    // The regression: clearing first left the baseline at PRE_AI, which never
    // matches disk, so every accept-all came back a conflict.
    expect(saveFile).toHaveBeenCalledWith(AGENT_WROTE, AGENT_WROTE);
    expect(model.read()).toBeUndefined();
    expect(outcome).toEqual({
      kind: 'saved',
      result: { success: true, filePath: '/a.md' },
      baseline: AGENT_WROTE,
    });
  });

  it('falls back to the tab baseline when no diff state remains', async () => {
    const saveFile = vi.fn().mockResolvedValue({ success: true, filePath: '/a.md' });

    await resolveDiffResolutionSave(PRE_AI, {
      readDiffBaseline: () => undefined,
      fallbackBaseline: PRE_AI,
      saveFile,
    });

    expect(saveFile).toHaveBeenCalledWith(PRE_AI, PRE_AI);
  });

  it('reports a conflict without asserting when disk moved after the diff', async () => {
    const saveFile = vi.fn().mockResolvedValue({
      success: false,
      conflict: true,
      filePath: '/a.md',
      diskContent: '# a second agent write\n',
    });

    const outcome = await resolveDiffResolutionSave(AGENT_WROTE, {
      readDiffBaseline: () => AGENT_WROTE,
      fallbackBaseline: PRE_AI,
      saveFile,
    });

    expect(outcome).toEqual({ kind: 'conflict', diskContent: '# a second agent write\n' });
  });

  it('reports a failed write separately from a conflict', async () => {
    const result = { success: false, errorType: 'permission', filePath: '/a.md' };
    const outcome = await resolveDiffResolutionSave(AGENT_WROTE, {
      readDiffBaseline: () => AGENT_WROTE,
      fallbackBaseline: PRE_AI,
      saveFile: vi.fn().mockResolvedValue(result),
    });

    expect(outcome).toEqual({ kind: 'failed', result });
  });
});
