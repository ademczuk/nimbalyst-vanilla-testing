import { parentPort } from 'node:worker_threads';
import { diffLines } from 'diff';
import {
  HISTORY_DIFF_MAX_EDIT_LENGTH,
  HISTORY_DIFF_TIMEOUT_MS,
  type HistoryDiffExecutionResult,
} from '../services/HistoryDiffService';

interface WorkerRequest {
  id: string;
  before: string;
  after: string;
}

if (!parentPort) {
  throw new Error('historyDiffWorker must run in a worker thread');
}

function countNonEmptyLines(value: string): number {
  return value ? value.split('\n').filter((line) => line !== '').length : 0;
}

const diffLinesWithRuntimeLimits = diffLines as unknown as (
  before: string,
  after: string,
  options: { timeout: number; maxEditLength: number },
) => Array<{ value: string; added?: boolean; removed?: boolean }> | undefined;

function computeDiff(before: string, after: string): HistoryDiffExecutionResult {
  const startedAt = Date.now();
  const changes = diffLinesWithRuntimeLimits(
    before,
    after,
    {
      timeout: HISTORY_DIFF_TIMEOUT_MS,
      maxEditLength: HISTORY_DIFF_MAX_EDIT_LENGTH,
    },
  );

  if (!changes) {
    return {
      status: 'omitted',
      reason: Date.now() - startedAt >= HISTORY_DIFF_TIMEOUT_MS
        ? 'time-limit'
        : 'edit-distance-limit',
    };
  }

  const removedLines: string[] = [];
  const addedLines: string[] = [];
  for (const change of changes) {
    if (change.removed) removedLines.push(change.value);
    if (change.added) addedLines.push(change.value);
  }

  if (removedLines.length === 0 && addedLines.length === 0) {
    return { status: 'none' };
  }

  const oldString = removedLines.join('');
  const newString = addedLines.join('');
  return {
    status: 'ready',
    oldString,
    newString,
    linesAdded: countNonEmptyLines(newString),
    linesRemoved: countNonEmptyLines(oldString),
  };
}

parentPort.on('message', (request: WorkerRequest) => {
  let result: HistoryDiffExecutionResult;
  try {
    result = computeDiff(request.before, request.after);
  } catch {
    result = { status: 'failed', errorCode: 'worker-failed' };
  }
  parentPort?.postMessage({ id: request.id, result });
});
