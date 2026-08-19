import { app } from 'electron';
import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { getPackageRoot } from '../utils/appPaths';
import { logger } from '../utils/logger';
import {
  HISTORY_DIFF_HARD_TIMEOUT_MS,
  type HistoryDiffExecutionResult,
  type HistoryDiffRunner,
} from './HistoryDiffService';

interface WorkerRequest {
  id: string;
  before: string;
  after: string;
}

interface WorkerResponse {
  id: string;
  result: HistoryDiffExecutionResult;
}

interface QueueItem {
  request: WorkerRequest;
  resolve: (result: HistoryDiffExecutionResult) => void;
}

const MAX_QUEUED_DIFFS = 4;

function resolveHistoryDiffWorkerPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'history-diff-worker.bundle.js');
  }
  return path.join(getPackageRoot(), 'out', 'history-diff-worker.bundle.js');
}

/** Serial, bounded worker client. Terminating the worker is the hard deadline. */
export class HistoryDiffWorkerClient {
  private worker: Worker | null = null;
  private active: QueueItem | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private queue: QueueItem[] = [];

  readonly runDiff: HistoryDiffRunner = (before, after) => {
    if (this.queue.length >= MAX_QUEUED_DIFFS) {
      return Promise.resolve({ status: 'failed', errorCode: 'queue-full' });
    }

    return new Promise((resolve) => {
      this.queue.push({
        request: { id: randomUUID(), before, after },
        resolve,
      });
      this.pump();
    });
  };

  dispose(): void {
    this.clearTimer();
    void this.worker?.terminate();
    this.worker = null;
    this.active?.resolve({ status: 'failed', errorCode: 'worker-failed' });
    this.active = null;
    for (const item of this.queue.splice(0)) {
      item.resolve({ status: 'failed', errorCode: 'worker-failed' });
    }
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;

    const worker = new Worker(resolveHistoryDiffWorkerPath());
    worker.on('message', (response: WorkerResponse) => this.handleResponse(response));
    worker.on('error', (error) => {
      logger.main.error('[HistoryDiffWorker] worker error', error);
      this.failAndRestart('worker-failed');
    });
    worker.on('exit', (code) => {
      if (this.worker !== worker) return;
      this.worker = null;
      if (code !== 0) {
        logger.main.warn('[HistoryDiffWorker] worker exited', { code });
        this.failActive('worker-failed');
      }
      this.pump();
    });
    this.worker = worker;
    return worker;
  }

  private pump(): void {
    if (this.active || this.queue.length === 0) return;
    const item = this.queue.shift();
    if (!item) return;

    this.active = item;
    this.ensureWorker().postMessage(item.request);
    this.timer = setTimeout(() => {
      logger.main.warn('[HistoryDiffWorker] hard timeout', {
        timeoutMs: HISTORY_DIFF_HARD_TIMEOUT_MS,
      });
      const timedOut = this.active;
      this.active = null;
      this.clearTimer();
      timedOut?.resolve({ status: 'omitted', reason: 'time-limit' });
      const worker = this.worker;
      this.worker = null;
      void worker?.terminate().finally(() => this.pump());
    }, HISTORY_DIFF_HARD_TIMEOUT_MS);
  }

  private handleResponse(response: WorkerResponse): void {
    if (!this.active || response.id !== this.active.request.id) return;
    const item = this.active;
    this.active = null;
    this.clearTimer();
    item.resolve(response.result);
    this.pump();
  }

  private failAndRestart(errorCode: 'worker-failed'): void {
    const worker = this.worker;
    this.worker = null;
    void worker?.terminate();
    this.failActive(errorCode);
    this.pump();
  }

  private failActive(errorCode: 'worker-failed'): void {
    const item = this.active;
    this.active = null;
    this.clearTimer();
    item?.resolve({ status: 'failed', errorCode });
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

export const historyDiffWorkerClient = new HistoryDiffWorkerClient();
