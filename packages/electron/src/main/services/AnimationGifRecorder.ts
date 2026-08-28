/**
 * Recording a self-playing HTML animation to an animated GIF.
 *
 * Capture lives in AnimationCapture; this file is the GIF half. The encoding
 * work -- colour conversion, palette, LZW -- is several seconds of
 * uninterruptible synchronous JS and goes to a worker thread. Run inline it
 * froze the whole app for a minute and a half on a ten-second animation.
 *
 * GIF is the wrong format for most destinations now: social platforms transcode
 * an uploaded GIF to H.264 anyway, so it pays a 256-colour quantization and
 * then gets re-encoded. It stays for the places that genuinely cannot play a
 * video. See AnimationVideoRecorder for the better path.
 */

import { captureAnimationFrames } from './AnimationCapture';
import { createGifEncodeSink } from './GifEncodeSink';
import { computeFrameDelays } from './gifEncoding';
import {
  ANIMATION_EXPORT_LIMITS,
  clampExportOptions,
} from './animationExportOptions';
import { logger } from '../utils/logger';

export interface AnimationGifRequest {
  /** Self-contained HTML built with `captureHooks: true`. */
  html: string;
  outputPath: string;
  /** Stage dimensions; the capture window is sized from these. */
  width: number;
  height: number;
  /** How long one pass of the animation takes, in milliseconds. */
  durationMs: number;
  /** Target frames per second. Clamped. */
  fps?: number;
  /** Width of the output. Clamped. */
  maxWidth?: number;
}

export interface AnimationGifResult {
  outputPath: string;
  frames: number;
  width: number;
  height: number;
  bytes: number;
  /** Frames per second actually achieved, which is what the GIF encodes. */
  effectiveFps: number;
}

/** GIF delays are centiseconds, and viewers clamp anything under 2 to 10. */
const MIN_DELAY_CS = 2;

export async function recordAnimationGif(
  request: AnimationGifRequest
): Promise<AnimationGifResult> {
  const { fps, maxWidth } = clampExportOptions(request);
  const sink = createGifEncodeSink();

  try {
    const capture = await captureAnimationFrames(
      {
        html: request.html,
        width: request.width,
        height: request.height,
        durationMs: request.durationMs,
        fps,
        maxWidth,
        maxFrames: ANIMATION_EXPORT_LIMITS.maxFrames,
      },
      (frame) => sink.addFrame(frame)
    );

    const delays = computeFrameDelays(
      capture.captureTimes,
      request.durationMs,
      MIN_DELAY_CS
    );
    const outcome = await sink.encode(delays, request.outputPath);

    const totalMs =
      capture.captureTimes[capture.captureTimes.length - 1] || request.durationMs;
    const result: AnimationGifResult = {
      outputPath: request.outputPath,
      frames: capture.captureTimes.length,
      width: capture.frameWidth,
      height: capture.frameHeight,
      bytes: outcome.bytes,
      effectiveFps:
        Math.round(
          (capture.captureTimes.length / Math.max(1, totalMs)) * 1000 * 10
        ) / 10,
    };

    const { prepareMs, paletteMs, mapMs, encodeMs } = outcome.timings;
    logger.file.info(
      `[AnimationGifRecorder] Wrote ${result.frames} frames to ${request.outputPath} ` +
        `(${result.width}x${result.height} from ${capture.captureWidth}x${capture.captureHeight}, ` +
        `${result.effectiveFps} fps, ${result.bytes} bytes, ` +
        `${outcome.paletteSize} colours, ${outcome.offThread ? 'off-thread' : 'MAIN THREAD'}: ` +
        `prepare ${prepareMs}ms, palette ${paletteMs}ms, map ${mapMs}ms, encode ${encodeMs}ms)`
    );
    return result;
  } finally {
    sink.dispose();
  }
}
