import * as zlib from 'node:zlib';

export const MAX_HISTORY_DIFF_INPUT_BYTES = 1024 * 1024;
export const HISTORY_DIFF_TIMEOUT_MS = 250;
export const HISTORY_DIFF_HARD_TIMEOUT_MS = 500;
export const HISTORY_DIFF_MAX_EDIT_LENGTH = 20_000;

export type HistoryDiffOmissionReason =
  | 'input-too-large'
  | 'time-limit'
  | 'edit-distance-limit';

export type HistoryDiffFailureCode =
  | 'snapshot-read-failed'
  | 'worker-failed'
  | 'queue-full';

export interface HistoryDiffReadyResult {
  status: 'ready';
  oldString: string;
  newString: string;
  linesAdded: number;
  linesRemoved: number;
}

export type HistoryDiffExecutionResult =
  | HistoryDiffReadyResult
  | { status: 'none' }
  | { status: 'omitted'; reason: Exclude<HistoryDiffOmissionReason, 'input-too-large'> }
  | { status: 'failed'; errorCode: Exclude<HistoryDiffFailureCode, 'snapshot-read-failed'> };

export type HistoryDiffComputationResult =
  | HistoryDiffReadyResult
  | { status: 'none' }
  | {
      status: 'omitted';
      reason: HistoryDiffOmissionReason;
      inputBytes?: { before: number; after: number };
      limitBytes?: number;
    }
  | { status: 'failed'; errorCode: HistoryDiffFailureCode };

export type HistoryDiffRunner = (
  before: string,
  after: string,
) => Promise<HistoryDiffExecutionResult>;

interface ComputeBoundedHistoryDiffInput {
  compressedBefore: Buffer;
  after?: Buffer;
  compressedAfter?: Buffer;
  runDiff: HistoryDiffRunner;
}

interface BoundedGunzipResult {
  buffer: Buffer | null;
  byteLength: number;
  tooLarge: boolean;
}

function gunzipWithLimit(compressed: Buffer): Promise<BoundedGunzipResult> {
  return new Promise((resolve, reject) => {
    zlib.gunzip(
      compressed,
      { maxOutputLength: MAX_HISTORY_DIFF_INPUT_BYTES + 1 },
      (error, buffer) => {
        if (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === 'ERR_BUFFER_TOO_LARGE' || /larger than|output size/i.test(error.message)) {
            resolve({
              buffer: null,
              byteLength: MAX_HISTORY_DIFF_INPUT_BYTES + 1,
              tooLarge: true,
            });
            return;
          }
          reject(error);
          return;
        }
        resolve({
          buffer,
          byteLength: buffer.byteLength,
          tooLarge: buffer.byteLength > MAX_HISTORY_DIFF_INPUT_BYTES,
        });
      },
    );
  });
}

/**
 * Inflate and compare a historical snapshot without allowing unbounded data to
 * reach the diff implementation. The runner is injected so the main process
 * can dispatch bounded strings to a worker while unit tests stay deterministic.
 */
export async function computeBoundedHistoryDiff({
  compressedBefore,
  after,
  compressedAfter,
  runDiff,
}: ComputeBoundedHistoryDiffInput): Promise<HistoryDiffComputationResult> {
  let before: BoundedGunzipResult;
  let afterBuffer: Buffer | null = after ?? null;
  let afterBytes = after?.byteLength ?? 0;
  let afterTooLarge = afterBytes > MAX_HISTORY_DIFF_INPUT_BYTES;

  try {
    before = await gunzipWithLimit(compressedBefore);
    if (compressedAfter) {
      const inflatedAfter = await gunzipWithLimit(compressedAfter);
      afterBuffer = inflatedAfter.buffer;
      afterBytes = inflatedAfter.byteLength;
      afterTooLarge = inflatedAfter.tooLarge;
    }
  } catch {
    return { status: 'failed', errorCode: 'snapshot-read-failed' };
  }

  if (before.tooLarge || afterTooLarge) {
    return {
      status: 'omitted',
      reason: 'input-too-large',
      inputBytes: {
        before: before.byteLength,
        after: afterBytes,
      },
      limitBytes: MAX_HISTORY_DIFF_INPUT_BYTES,
    };
  }

  if (!before.buffer || !afterBuffer) {
    return { status: 'failed', errorCode: 'snapshot-read-failed' };
  }

  const beforeContent = before.buffer.toString('utf8');
  const afterContent = afterBuffer.toString('utf8');
  if (beforeContent === afterContent) return { status: 'none' };

  return runDiff(beforeContent, afterContent);
}
