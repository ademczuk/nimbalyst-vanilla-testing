/**
 * The GIF export's CPU half, on its own thread.
 *
 * Frames arrive one at a time as they are captured rather than in a single
 * batch at the end, so the main process holds one frame's pixels rather than
 * all of them. Nothing here touches Electron -- see gifEncoding.ts for why the
 * work has to leave the main thread at all.
 */

import { parentPort } from 'node:worker_threads';
import { writeFile } from 'node:fs/promises';
import { encodeAnimationGif, type FrameBitmap } from '../services/gifEncoding';

export interface GifWorkerFrameMessage {
  type: 'frame';
  width: number;
  height: number;
  data: Uint8Array;
}

export interface GifWorkerEncodeMessage {
  type: 'encode';
  delays: number[];
  outputPath: string;
}

export type GifWorkerMessage = GifWorkerFrameMessage | GifWorkerEncodeMessage;

export interface GifWorkerResult {
  ok: boolean;
  error?: string;
  bytes?: number;
  paletteSize?: number;
  timings?: { prepareMs: number; paletteMs: number; mapMs: number; encodeMs: number };
}

if (!parentPort) {
  throw new Error('gifEncodeWorker must run in a worker thread');
}

const frames: FrameBitmap[] = [];

parentPort.on('message', (message: GifWorkerMessage) => {
  if (message.type === 'frame') {
    frames.push({
      width: message.width,
      height: message.height,
      data: Buffer.from(
        message.data.buffer,
        message.data.byteOffset,
        message.data.byteLength
      ),
    });
    return;
  }

  void (async () => {
    try {
      const result = await encodeAnimationGif({ frames, delays: message.delays });
      await writeFile(message.outputPath, result.buffer);
      parentPort?.postMessage({
        ok: true,
        bytes: result.buffer.length,
        paletteSize: result.paletteSize,
        timings: result.timings,
      } satisfies GifWorkerResult);
    } catch (error) {
      parentPort?.postMessage({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      } satisfies GifWorkerResult);
    } finally {
      frames.length = 0;
    }
  })();
});
