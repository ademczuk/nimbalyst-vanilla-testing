/**
 * Where captured frames go while an export is running.
 *
 * A worker thread when the bundle is there, and inline when it is not. The
 * inline path reinstates the main-thread stall that motivated the worker, so it
 * is a packaging-miss degrade rather than a supported mode -- but an export
 * that blocks is better than an export that cannot run at all.
 */

import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { getPackageRoot } from '../utils/appPaths';
import { logger } from '../utils/logger';
import { encodeAnimationGif, type FrameBitmap } from './gifEncoding';
import type {
  GifWorkerResult,
} from '../workers/gifEncodeWorker';

export const GIF_WORKER_FILENAME = 'gif-encode-worker.bundle.js';

/**
 * A runaway export kills the worker instead of the app. Bounded well above what
 * a legitimate export needs: the palette pass works off a subsample, so the
 * live set is the frames themselves, ~1 MB each at the default width.
 */
const WORKER_MAX_OLD_GENERATION_MB = 2048;

export interface GifEncodeOutcome {
  bytes: number;
  paletteSize: number;
  timings: { prepareMs: number; paletteMs: number; mapMs: number; encodeMs: number };
  /** False when the worker was unavailable and the main thread did the work. */
  offThread: boolean;
}

export function resolveGifWorkerPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, GIF_WORKER_FILENAME);
  }
  return path.join(getPackageRoot(), 'out', GIF_WORKER_FILENAME);
}

export interface GifEncodeSink {
  addFrame(frame: FrameBitmap): void;
  encode(delays: number[], outputPath: string): Promise<GifEncodeOutcome>;
  dispose(): void;
}

class InlineGifEncodeSink implements GifEncodeSink {
  private readonly frames: FrameBitmap[] = [];

  addFrame(frame: FrameBitmap): void {
    this.frames.push(frame);
  }

  async encode(delays: number[], outputPath: string): Promise<GifEncodeOutcome> {
    const result = await encodeAnimationGif({ frames: this.frames, delays });
    await writeFile(outputPath, result.buffer);
    return {
      bytes: result.buffer.length,
      paletteSize: result.paletteSize,
      timings: result.timings,
      offThread: false,
    };
  }

  dispose(): void {
    this.frames.length = 0;
  }
}

class WorkerGifEncodeSink implements GifEncodeSink {
  constructor(private readonly worker: Worker) {}

  addFrame(frame: FrameBitmap): void {
    this.worker.postMessage({
      type: 'frame',
      width: frame.width,
      height: frame.height,
      data: frame.data,
    });
  }

  encode(delays: number[], outputPath: string): Promise<GifEncodeOutcome> {
    return new Promise((resolve, reject) => {
      const settle = (fn: () => void) => {
        this.worker.removeAllListeners('message');
        this.worker.removeAllListeners('error');
        this.worker.removeAllListeners('exit');
        fn();
      };

      this.worker.on('message', (result: GifWorkerResult) => {
        settle(() =>
          result.ok
            ? resolve({
                bytes: result.bytes ?? 0,
                paletteSize: result.paletteSize ?? 0,
                timings: result.timings ?? {
                  prepareMs: 0,
                  paletteMs: 0,
                  mapMs: 0,
                  encodeMs: 0,
                },
                offThread: true,
              })
            : reject(new Error(result.error ?? 'GIF encoding failed.'))
        );
      });
      this.worker.on('error', (error) => settle(() => reject(error)));
      this.worker.on('exit', (code) =>
        settle(() =>
          reject(
            new Error(
              code === 1
                ? 'The GIF encoder ran out of memory. Export fewer frames or a smaller width.'
                : `GIF encoding worker exited (code ${code}) without a result.`
            )
          )
        )
      );

      this.worker.postMessage({ type: 'encode', delays, outputPath });
    });
  }

  dispose(): void {
    void this.worker.terminate();
  }
}

/** A worker-backed sink, or an inline one when the worker cannot be started. */
export function createGifEncodeSink(): GifEncodeSink {
  const workerPath = resolveGifWorkerPath();
  if (!fs.existsSync(workerPath)) {
    logger.file.warn(
      `[AnimationGifRecorder] Encoder bundle missing at ${workerPath}; encoding on the main thread`
    );
    return new InlineGifEncodeSink();
  }

  try {
    return new WorkerGifEncodeSink(
      new Worker(workerPath, {
        resourceLimits: { maxOldGenerationSizeMb: WORKER_MAX_OLD_GENERATION_MB },
      })
    );
  } catch (error) {
    logger.file.warn(
      '[AnimationGifRecorder] Could not start the encoder worker; encoding on the main thread',
      error
    );
    return new InlineGifEncodeSink();
  }
}
