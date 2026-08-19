import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import {
  MAX_HISTORY_DIFF_INPUT_BYTES,
  computeBoundedHistoryDiff,
} from '../HistoryDiffService';

describe('computeBoundedHistoryDiff', () => {
  it('omits the oversized #1191 history snapshot before dispatching diff work', async () => {
    const runDiff = vi.fn();
    const before = 'snapshot line\n'.repeat(Math.ceil(9_214_783 / 14));
    const after = 'regenerated line\n'.repeat(Math.ceil(4_613_796 / 17));

    const result = await computeBoundedHistoryDiff({
      compressedBefore: gzipSync(before),
      after: Buffer.from(after),
      runDiff,
    });

    expect(Buffer.byteLength(before)).toBeGreaterThan(MAX_HISTORY_DIFF_INPUT_BYTES);
    expect(Buffer.byteLength(after)).toBeGreaterThan(MAX_HISTORY_DIFF_INPUT_BYTES);
    expect(result).toEqual({
      status: 'omitted',
      reason: 'input-too-large',
      inputBytes: {
        before: MAX_HISTORY_DIFF_INPUT_BYTES + 1,
        after: Buffer.byteLength(after),
      },
      limitBytes: MAX_HISTORY_DIFF_INPUT_BYTES,
    });
    expect(runDiff).not.toHaveBeenCalled();
  });

  it('uses the stable ai-edit snapshot instead of a later disk rewrite', async () => {
    const runDiff = vi.fn().mockResolvedValue({
      status: 'ready',
      oldString: 'before\n',
      newString: 'after tool\n',
      linesAdded: 1,
      linesRemoved: 1,
    });

    const result = await computeBoundedHistoryDiff({
      compressedBefore: gzipSync('before\n'),
      compressedAfter: gzipSync('after tool\n'),
      after: Buffer.from('unrelated later rewrite\n'),
      runDiff,
    });

    expect(runDiff).toHaveBeenCalledWith('before\n', 'after tool\n');
    expect(result).toMatchObject({ status: 'ready', newString: 'after tool\n' });
  });
});
