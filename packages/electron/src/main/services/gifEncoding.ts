/**
 * Turning captured frames into GIF bytes.
 *
 * Split out of AnimationGifRecorder because this half is pure CPU with no
 * Electron in it, which is what lets it run on a worker thread. It has to: a
 * 10-second export is ~120 frames of ~276k pixels, and both halves of the naive
 * pipeline are synchronous JS that would otherwise stop the main process for a
 * minute and a half.
 *
 * The expensive part is not the LZW encode, it is deriving the palette.
 * `GifUtil.quantizeWu(frames)` samples every frame into an `image-q`
 * PointContainer and keeps all of them alive until the last one is mapped --
 * one object per pixel, so 120 frames needs several GB and dies on the way.
 *
 * So the palette is derived from a bounded subsample instead: a handful of
 * frames, thinned to a few thousand pixels each, is more than enough to
 * describe the colour distribution of a diagram animation. Every frame is then
 * mapped to that one shared palette. Shared is the point -- a per-frame palette
 * makes flat background areas shimmer between frames.
 */

import { GifCodec, GifFrame, GifUtil } from 'gifwrap';

export interface FrameBitmap {
  width: number;
  height: number;
  /** RGBA, one byte per channel. */
  data: Buffer;
}

/** GIF indexes a maximum of 256 colours, transparency included. */
const MAX_PALETTE = 256;

/**
 * Render the stage at this multiple of the output width, then reduce.
 *
 * The scene is an SVG filling the viewport, so a larger capture window renders
 * genuinely more detail rather than magnifying the same pixels. Reducing it
 * afterwards averages several rendered pixels into each output pixel, which is
 * what keeps the mono type legible -- reducing a 1x render by 0.67, which is
 * what a default 720px export of a 1080px stage used to be, leaves the labels
 * mushy no matter how good the palette is.
 */
const SUPERSAMPLE = 2;

/** Ceiling on the capture window, so a native-width export stays sane. */
const MAX_CAPTURE_WIDTH = 2560;

/**
 * The capture window's size: the output width supersampled, but never below
 * the stage's own dimensions and never past the ceiling.
 */
export function captureSize(
  stageWidth: number,
  stageHeight: number,
  outputWidth: number,
  supersample = SUPERSAMPLE,
  maxCaptureWidth = MAX_CAPTURE_WIDTH
): { width: number; height: number } {
  const aspect = stageHeight / Math.max(1, stageWidth);
  const wanted = Math.max(stageWidth, outputWidth * supersample);
  const width = Math.round(Math.min(wanted, maxCaptureWidth));
  return { width, height: Math.max(1, Math.round(width * aspect)) };
}

/** Frames fed to the quantizer. More than this buys no palette accuracy. */
const PALETTE_SAMPLE_FRAMES = 8;

/**
 * Pixels kept per sampled frame. A stride over the frame, not a crop.
 *
 * High enough that the sample is a fair estimate of the frame's colour count --
 * too thin a stride would see 200 colours in a photographic frame and take the
 * exact-palette path on the strength of it, mapping everything it missed to
 * whichever of those 200 happened to be nearest.
 */
const PALETTE_SAMPLE_PIXELS = 16384;

/**
 * Electron hands back BGRA; GIF frames want RGBA. Swapping in place avoids a
 * second buffer per frame, which matters when a hundred of them are live.
 *
 * Getting this backwards is invisible in every structural check -- the GIF has
 * the right size, frame count and timing, and only the colours are wrong, with
 * the palette rotated so blue reads as orange. Hence the test.
 */
export function bgraToRgbaInPlace(data: Buffer): Buffer {
  for (let i = 0; i < data.length; i += 4) {
    const b = data[i];
    data[i] = data[i + 2];
    data[i + 2] = b;
  }
  return data;
}

/**
 * GIF has no alpha blending, only a single fully-transparent index. Any
 * partially-transparent pixel would otherwise quantize to something arbitrary,
 * so flatten onto the stage background first.
 */
export function flattenAlpha(data: Buffer): Buffer {
  for (let i = 3; i < data.length; i += 4) {
    data[i] = 255;
  }
  return data;
}

/**
 * Per-frame hold times, in centiseconds, from the moment each frame was
 * actually captured.
 *
 * Capture is wall-clock bound, so frames are never evenly spaced. Deriving each
 * delay from measured timestamps is what keeps a GIF recorded on a slow machine
 * the right *duration* -- it goes choppy rather than into slow motion. The last
 * frame holds until the loop point so the GIF does not end a frame early.
 */
export function computeFrameDelays(
  captureTimes: number[],
  durationMs: number,
  minDelayCs = 2
): number[] {
  return captureTimes.map((at, index) => {
    const nextAt =
      index + 1 < captureTimes.length ? captureTimes[index + 1] : durationMs;
    return Math.max(minDelayCs, Math.round((nextAt - at) / 10));
  });
}

/** Indexes of the frames used to derive the palette, always including the ends. */
export function paletteSampleIndexes(
  frameCount: number,
  sampleCount = PALETTE_SAMPLE_FRAMES
): number[] {
  if (frameCount <= sampleCount) {
    return Array.from({ length: frameCount }, (_, i) => i);
  }
  const step = (frameCount - 1) / (sampleCount - 1);
  const picked = new Set<number>();
  for (let i = 0; i < sampleCount; i++) picked.add(Math.round(i * step));
  return [...picked].sort((a, b) => a - b);
}

/**
 * A frame thinned to at most `maxPixels`, laid out as a single row.
 *
 * The quantizer only reads the colour distribution, so geometry is irrelevant
 * and a stride keeps every region of the frame represented -- a crop would
 * derive the palette from one corner of the stage.
 */
export function thinFrame(frame: FrameBitmap, maxPixels = PALETTE_SAMPLE_PIXELS): FrameBitmap {
  const pixels = frame.width * frame.height;
  if (pixels <= maxPixels) {
    return { width: pixels, height: 1, data: Buffer.from(frame.data) };
  }
  const stride = Math.ceil(pixels / maxPixels);
  const kept = Math.ceil(pixels / stride);
  const data = Buffer.alloc(kept * 4);
  for (let out = 0, src = 0; out < kept; out++, src += stride) {
    frame.data.copy(data, out * 4, src * 4, src * 4 + 4);
  }
  return { width: kept, height: 1, data };
}

/** Distinct packed colours, or null once the count passes `limit`. */
export function distinctColors(
  frames: FrameBitmap[],
  limit: number
): Set<number> | null {
  const seen = new Set<number>();
  for (const frame of frames) {
    for (let i = 0; i < frame.data.length; i += 4) {
      seen.add(frame.data.readUInt32LE(i));
      if (seen.size > limit) return null;
    }
  }
  return seen;
}

/**
 * One palette for the whole animation, as packed RGBA values.
 *
 * Diagram animations routinely use fewer than 256 colours outright, in which
 * case quantizing at all would only lose fidelity -- so the exact set wins when
 * it fits, and Wu is the fallback for anything with gradients or heavy
 * antialiasing.
 */
export function buildSharedPalette(samples: FrameBitmap[]): number[] {
  const exact = distinctColors(samples, MAX_PALETTE);
  if (exact) return [...exact];

  const copies = samples.map(
    (frame) =>
      new GifFrame({
        width: frame.width,
        height: frame.height,
        data: Buffer.from(frame.data),
      })
  );
  GifUtil.quantizeWu(copies, MAX_PALETTE);

  const quantized = distinctColors(
    copies.map((frame) => frame.bitmap as FrameBitmap),
    MAX_PALETTE
  );
  if (quantized) return [...quantized];

  // Wu is documented to return at most MAX_PALETTE colours, so this is a
  // contract violation rather than an expected branch -- but silently emitting
  // a frame the codec then rejects would be worse than trimming.
  const counted = new Map<number, number>();
  for (const frame of copies) {
    const data = frame.bitmap.data;
    for (let i = 0; i < data.length; i += 4) {
      const color = data.readUInt32LE(i);
      counted.set(color, (counted.get(color) ?? 0) + 1);
    }
  }
  return [...counted.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_PALETTE)
    .map(([color]) => color);
}

/**
 * Rewrite a frame's pixels to the nearest palette entry.
 *
 * `cache` is shared across frames and is what makes this cheap: a frame has
 * hundreds of thousands of pixels but only a few thousand distinct colours, and
 * consecutive frames of an animation are nearly the same few thousand.
 */
export function applyPalette(
  frame: FrameBitmap,
  palette: number[],
  cache: Map<number, number>
): FrameBitmap {
  const { data } = frame;
  for (let i = 0; i < data.length; i += 4) {
    const color = data.readUInt32LE(i);
    let mapped = cache.get(color);
    if (mapped === undefined) {
      mapped = nearestColor(color, palette);
      cache.set(color, mapped);
    }
    if (mapped !== color) data.writeUInt32LE(mapped, i);
  }
  return frame;
}

function nearestColor(color: number, palette: number[]): number {
  const r = color & 0xff;
  const g = (color >>> 8) & 0xff;
  const b = (color >>> 16) & 0xff;

  let best = palette[0];
  let bestDistance = Infinity;
  for (const candidate of palette) {
    const dr = r - (candidate & 0xff);
    const dg = g - ((candidate >>> 8) & 0xff);
    const db = b - ((candidate >>> 16) & 0xff);
    const distance = dr * dr + dg * dg + db * db;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
      if (distance === 0) break;
    }
  }
  return best;
}

export interface EncodeGifRequest {
  /** BGRA as captured, converted in place. Consumed, not copied. */
  frames: FrameBitmap[];
  /** Hold time per frame, in centiseconds. */
  delays: number[];
}

export interface EncodeGifResult {
  buffer: Buffer;
  paletteSize: number;
  /** Milliseconds in each stage, for the slow-export postmortem. */
  timings: { prepareMs: number; paletteMs: number; mapMs: number; encodeMs: number };
}

/**
 * The whole CPU half of an export: colour conversion, one shared palette, and
 * the LZW encode. Pure, so it runs identically on a worker thread and inline.
 */
export async function encodeAnimationGif(
  request: EncodeGifRequest
): Promise<EncodeGifResult> {
  if (request.frames.length === 0) throw new Error('No frames were captured.');

  let mark = Date.now();
  for (const frame of request.frames) {
    flattenAlpha(bgraToRgbaInPlace(frame.data));
  }
  const prepareMs = Date.now() - mark;

  mark = Date.now();
  const samples = paletteSampleIndexes(request.frames.length).map((index) =>
    thinFrame(request.frames[index])
  );
  const palette = buildSharedPalette(samples);
  const paletteMs = Date.now() - mark;

  mark = Date.now();
  const cache = new Map<number, number>();
  for (const frame of request.frames) applyPalette(frame, palette, cache);
  const mapMs = Date.now() - mark;

  mark = Date.now();
  const frames = request.frames.map(
    (frame, index) =>
      new GifFrame(frame, { delayCentisecs: request.delays[index] })
  );
  const { buffer } = await new GifCodec().encodeGif(frames, { loops: 0 });
  const encodeMs = Date.now() - mark;

  return {
    buffer,
    paletteSize: palette.length,
    timings: { prepareMs, paletteMs, mapMs, encodeMs },
  };
}
