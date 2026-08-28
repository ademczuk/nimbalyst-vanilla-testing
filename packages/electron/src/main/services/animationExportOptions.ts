/**
 * The bounds both animation exporters agree on.
 *
 * Shared so a GIF and an MP4 of the same animation are the same size and speed,
 * and so the limits can be asserted without an Electron window in the test.
 */

export const ANIMATION_EXPORT_LIMITS = {
  minFps: 2,
  maxFps: 60,
  minWidth: 160,
  maxWidth: 1920,
  /**
   * A ceiling on frames held at once. At the default width a frame is roughly
   * 2 MB of RGBA, so an unbounded capture of a long animation is an
   * out-of-memory bug waiting for its first slow machine.
   */
  maxFrames: 240,
} as const;

/**
 * Defaults differ by format because the formats fail differently.
 *
 * A GIF pays for every frame twice -- palette and LZW -- so its size grows with
 * frame rate faster than its smoothness improves; 12 is where a diagram still
 * reads. H.264 encodes a mostly-static stage almost for free, so there is no
 * reason not to give video the frame rate that makes motion look right.
 */
export const ANIMATION_EXPORT_DEFAULTS = {
  gif: { fps: 12, maxWidth: 960 },
  mp4: { fps: 30, maxWidth: 1440 },
} as const;

export type AnimationExportFormat = keyof typeof ANIMATION_EXPORT_DEFAULTS;

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

export function clampExportOptions(
  request: { fps?: number; maxWidth?: number },
  format: AnimationExportFormat = 'gif'
): { fps: number; maxWidth: number } {
  const defaults = ANIMATION_EXPORT_DEFAULTS[format];
  const limits = ANIMATION_EXPORT_LIMITS;
  return {
    fps: clamp(
      Math.round(request.fps ?? defaults.fps),
      limits.minFps,
      limits.maxFps
    ),
    maxWidth: clamp(
      Math.round(request.maxWidth ?? defaults.maxWidth),
      limits.minWidth,
      limits.maxWidth
    ),
  };
}

/**
 * H.264 requires even dimensions in 4:2:0, and a capture reduced to an odd
 * width silently fails to encode rather than being rounded for you.
 */
export function toEvenDimensions(width: number, height: number): {
  width: number;
  height: number;
} {
  return {
    width: Math.max(2, width - (width % 2)),
    height: Math.max(2, height - (height % 2)),
  };
}
