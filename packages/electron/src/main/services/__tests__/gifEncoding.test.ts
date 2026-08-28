// @vitest-environment node
/**
 * The frame pipeline's silent failure modes.
 *
 * Everything else about a GIF export is loudly wrong when it breaks -- no file,
 * no frames, a thrown error. These are not: a reversed channel swap yields a
 * perfectly valid GIF in the wrong colours, bad delay maths yields a perfectly
 * valid GIF at the wrong speed, and a palette derived per frame yields a
 * perfectly valid GIF that shimmers. None is visible in the frame count, the
 * dimensions or the byte size.
 *
 * The size assertion is the other half: quantizing every frame at once needed
 * several GB and ~90s for a ten-second animation, and nothing about the output
 * says whether that happened.
 */

import { describe, expect, it } from 'vitest';
import {
  applyPalette,
  bgraToRgbaInPlace,
  buildSharedPalette,
  captureSize,
  computeFrameDelays,
  distinctColors,
  encodeAnimationGif,
  flattenAlpha,
  paletteSampleIndexes,
  thinFrame,
  type FrameBitmap,
} from '../gifEncoding';

function packed(r: number, g: number, b: number): number {
  return (r | (g << 8) | (b << 16) | (255 << 24)) >>> 0;
}

/** A frame of solid colour, in RGBA. */
function solidFrame(width: number, height: number, color: number): FrameBitmap {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.writeUInt32LE(color, i);
  return { width, height, data };
}

describe('captureSize', () => {
  it('renders above the output width so the reduction can supersample', () => {
    // The default export is 720 wide from a 1080 stage. Capturing at 1080 and
    // reducing by 0.67 is what left the mono labels mushy.
    expect(captureSize(1080, 576, 720)).toEqual({ width: 1440, height: 768 });
  });

  it('never renders below the stage, so a small export is not upscaled first', () => {
    expect(captureSize(1080, 576, 200)).toEqual({ width: 1080, height: 576 });
  });

  it('caps the capture window rather than rendering a 3200px stage', () => {
    const capped = captureSize(1600, 900, 1600);
    expect(capped.width).toBe(2560);
    expect(capped.height).toBe(1440);
  });

  it('keeps the stage aspect, so the GIF is not letterboxed or stretched', () => {
    const { width, height } = captureSize(1080, 470, 720);
    expect(width / height).toBeCloseTo(1080 / 470, 2);
  });
});

describe('bgraToRgbaInPlace', () => {
  it('swaps blue and red and leaves green and alpha alone', () => {
    // Electron's accent blue, #60a5fa, arrives as BGRA: 250, 165, 96, 255.
    const data = Buffer.from([250, 165, 96, 255]);
    const out = bgraToRgbaInPlace(data);

    expect([...out]).toEqual([96, 165, 250, 255]);
    // In place, so the caller's buffer is the converted one.
    expect(out).toBe(data);
  });

  it('is its own inverse, so a double call is detectable', () => {
    const once = bgraToRgbaInPlace(Buffer.from([250, 165, 96, 255]));
    expect([...bgraToRgbaInPlace(Buffer.from(once))]).toEqual([
      250, 165, 96, 255,
    ]);
  });
});

describe('flattenAlpha', () => {
  it('makes every pixel opaque', () => {
    const data = Buffer.from([10, 20, 30, 0, 40, 50, 60, 128]);
    expect([...flattenAlpha(data)]).toEqual([10, 20, 30, 255, 40, 50, 60, 255]);
  });
});

describe('computeFrameDelays', () => {
  it('derives each hold from the gap to the next captured frame', () => {
    expect(computeFrameDelays([0, 80, 160], 240)).toEqual([8, 8, 8]);
  });

  it('holds the final frame until the loop point', () => {
    // Without this the GIF ends a frame early and the loop stutters.
    expect(computeFrameDelays([0, 100], 1000).at(-1)).toBe(90);
  });

  it('tracks uneven capture so a slow machine stays the right duration', () => {
    // A stalled capture must lengthen that frame's hold, not silently drop it,
    // or the GIF plays back faster than the animation actually runs.
    const delays = computeFrameDelays([0, 100, 600, 700], 800);
    expect(delays).toEqual([10, 50, 10, 10]);
    expect(delays.reduce((a, b) => a + b, 0) * 10).toBe(800);
  });

  it('never emits a delay viewers silently clamp to 10cs', () => {
    // Anything under 2cs is rewritten to 10cs by most viewers, which would turn
    // a fast capture into a five-times-slower GIF.
    expect(computeFrameDelays([0, 5, 10], 15).every((d) => d >= 2)).toBe(true);
  });
});

describe('palette sampling', () => {
  it('always samples both ends of the animation', () => {
    // A palette derived from the middle misses whatever the last step
    // introduces, and the final frames quantize to something arbitrary.
    const indexes = paletteSampleIndexes(120, 8);
    expect(indexes[0]).toBe(0);
    expect(indexes.at(-1)).toBe(119);
    expect(indexes.length).toBe(8);
  });

  it('takes every frame when there are fewer than the sample size', () => {
    expect(paletteSampleIndexes(3, 8)).toEqual([0, 1, 2]);
  });

  it('thins by striding across the frame, not cropping a corner', () => {
    // A crop would derive the palette from one region of the stage.
    const data = Buffer.alloc(8 * 4);
    for (let i = 0; i < 8; i++) data.writeUInt32LE(packed(i, 0, 0), i * 4);

    const thinned = thinFrame({ width: 8, height: 1, data }, 4);
    const reds = [];
    for (let i = 0; i < thinned.data.length; i += 4) {
      reds.push(thinned.data[i]);
    }
    expect(reds).toEqual([0, 2, 4, 6]);
    expect(thinned.width * thinned.height * 4).toBe(thinned.data.length);
  });
});

describe('buildSharedPalette', () => {
  it('keeps colours exactly when the animation has fewer than 256', () => {
    // Quantizing a diagram that already fits would only lose fidelity.
    const colors = [packed(250, 250, 250), packed(96, 165, 250), packed(26, 26, 26)];
    const frames = colors.map((color) => solidFrame(4, 1, color));

    expect(new Set(buildSharedPalette(frames))).toEqual(new Set(colors));
  });

  it('reduces to at most 256 colours when the frames exceed it', () => {
    const data = Buffer.alloc(2000 * 4);
    for (let i = 0; i < 2000; i++) {
      data.writeUInt32LE(packed(i & 255, (i >> 3) & 255, (i >> 5) & 255), i * 4);
    }

    const palette = buildSharedPalette([{ width: 2000, height: 1, data }]);
    expect(palette.length).toBeGreaterThan(0);
    expect(palette.length).toBeLessThanOrEqual(256);
  });
});

describe('applyPalette', () => {
  it('maps an unlisted colour to its nearest palette entry', () => {
    const palette = [packed(0, 0, 0), packed(255, 255, 255)];
    const frame = solidFrame(2, 1, packed(250, 250, 250));

    applyPalette(frame, palette, new Map());

    expect(frame.data.readUInt32LE(0)).toBe(packed(255, 255, 255));
    expect(frame.data.readUInt32LE(4)).toBe(packed(255, 255, 255));
  });

  it('shares its cache across frames so repeated colours cost one search', () => {
    const palette = [packed(0, 0, 0), packed(255, 255, 255)];
    const cache = new Map<number, number>();

    applyPalette(solidFrame(2, 1, packed(250, 250, 250)), palette, cache);
    applyPalette(solidFrame(2, 1, packed(250, 250, 250)), palette, cache);

    expect(cache.size).toBe(1);
  });
});

describe('encodeAnimationGif', () => {
  it('encodes captured BGRA frames into a GIF with one shared palette', async () => {
    // Frames arrive as BGRA, so the blue channel leads. A per-frame palette
    // would let the same background quantize differently frame to frame.
    const frames = [
      solidFrame(8, 8, packed(250, 165, 96)),
      solidFrame(8, 8, packed(250, 165, 96)),
      solidFrame(8, 8, packed(26, 26, 26)),
    ];

    const result = await encodeAnimationGif({ frames, delays: [8, 8, 8] });

    expect(result.buffer.subarray(0, 6).toString('latin1')).toBe('GIF89a');
    expect(result.paletteSize).toBe(2);
    // Read back as RGBA: the leading 250 must have become the red channel.
    expect([...frames[0].data.subarray(0, 4)]).toEqual([96, 165, 250, 255]);
  });

  it('refuses an empty capture rather than writing a zero-frame GIF', async () => {
    await expect(encodeAnimationGif({ frames: [], delays: [] })).rejects.toThrow(
      /No frames/
    );
  });

  it('derives the palette from a bounded subsample, not every frame', async () => {
    // The regression this guards: quantizing all N frames at once held an
    // image-q point object per pixel per frame, which needed several GB and
    // ~90 seconds for a ten-second export. Sampling keeps the palette pass
    // flat as the animation gets longer.
    const long = Array.from({ length: 120 }, (_, i) =>
      solidFrame(64, 64, packed(i & 255, 128, 200))
    );
    const short = long.slice(0, 8);

    const longResult = await encodeAnimationGif({
      frames: long,
      delays: long.map(() => 8),
    });
    const shortResult = await encodeAnimationGif({
      frames: short,
      delays: short.map(() => 8),
    });

    // Fifteen times the frames must not mean fifteen times the palette work.
    expect(longResult.timings.paletteMs).toBeLessThanOrEqual(
      Math.max(50, shortResult.timings.paletteMs * 4)
    );
  });
});

describe('distinctColors', () => {
  it('bails out instead of counting every colour of a photographic frame', () => {
    const data = Buffer.alloc(1000 * 4);
    for (let i = 0; i < 1000; i++) {
      data.writeUInt32LE(packed(i & 255, (i >> 2) & 255, (i >> 4) & 255), i * 4);
    }
    expect(distinctColors([{ width: 1000, height: 1, data }], 16)).toBeNull();
  });
});
