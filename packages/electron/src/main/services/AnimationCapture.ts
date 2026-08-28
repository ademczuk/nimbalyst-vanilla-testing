/**
 * Playing an animation in an offscreen window and taking frames off it.
 *
 * Why this runs against a real compositor rather than stamping frames somewhere
 * cheaper: the animations we export interpolate with CSS transitions and move
 * their packets with CSS animations. Nothing outside a browser knows what the
 * halfway point between two states looks like, so anything that computes frames
 * itself is reimplementing CSS and will drift from what the editor shows.
 * Capturing a page that is genuinely playing is the only version that cannot
 * disagree with the editor.
 *
 * The consequence is that capture is wall-clock bound: we record in real time
 * and take whatever frame rate the machine can sustain. That is deliberate.
 * Each frame carries the moment it was taken, so a slow machine produces a
 * choppier export of the correct duration rather than a smooth one in slow
 * motion.
 *
 * Both exporters share this. Only what happens to the frames differs.
 */

import { BrowserWindow, type NativeImage } from 'electron';
import { captureSize, type FrameBitmap } from './gifEncoding';

export interface AnimationCaptureRequest {
  /** Self-contained HTML built with `captureHooks: true`. */
  html: string;
  /** Stage dimensions; the capture window is sized from these. */
  width: number;
  height: number;
  /** How long one pass of the animation takes, in milliseconds. */
  durationMs: number;
  /** Target frames per second. */
  fps: number;
  /** Width of the output. The capture window renders above it and reduces. */
  maxWidth: number;
  /** Ceiling on frames, so a long animation cannot exhaust memory. */
  maxFrames: number;
}

export interface AnimationCaptureResult {
  /** Milliseconds from t=0 at which each frame was taken. */
  captureTimes: number[];
  frameWidth: number;
  frameHeight: number;
  /** What the compositor actually rendered, before the reduction. */
  captureWidth: number;
  captureHeight: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Reduce on the way out of the compositor, while the pixels are still a
 * NativeImage and the work is native.
 */
function toFrameBitmap(image: NativeImage, targetWidth: number): FrameBitmap {
  const resized =
    image.getSize().width > targetWidth
      ? image.resize({ width: targetWidth, quality: 'best' })
      : image;
  const { width, height } = resized.getSize();
  return { width, height, data: resized.toBitmap() };
}

/**
 * Play the animation once and hand each frame to `onFrame` as it is taken.
 *
 * Frames are passed on immediately rather than collected, so the caller decides
 * whether to hold them and the main process holds one at a time either way.
 */
export async function captureAnimationFrames(
  request: AnimationCaptureRequest,
  onFrame: (frame: FrameBitmap, atMs: number) => void
): Promise<AnimationCaptureResult> {
  const frameInterval = 1000 / request.fps;
  const capture = captureSize(request.width, request.height, request.maxWidth);

  const captureTimes: number[] = [];
  let frameWidth = 0;
  let frameHeight = 0;
  let window: BrowserWindow | null = null;

  try {
    window = new BrowserWindow({
      show: false,
      width: capture.width,
      height: capture.height,
      useContentSize: true,
      webPreferences: {
        offscreen: true,
        nodeIntegration: false,
        contextIsolation: true,
        // A throttled window stops advancing rAF and CSS animations, which
        // would record the first frame N times over.
        backgroundThrottling: false,
      },
    });

    await window.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(request.html)}`
    );

    // Let fonts and the first paint settle before the clock starts, or the
    // opening frames capture an unstyled or half-drawn stage.
    await sleep(250);

    // Start the animation at t=0 on our signal rather than trusting load
    // timing. Missing hooks means the HTML was built without `captureHooks`.
    const hasHooks = await window.webContents.executeJavaScript(
      'Boolean(window.__anim && window.__anim.restart) && (window.__anim.restart(), true)'
    );
    if (!hasHooks) {
      throw new Error(
        'The animation HTML was built without capture hooks, so recording cannot be synchronised.'
      );
    }

    const started = Date.now();
    let nextSlot = started;

    while (captureTimes.length < request.maxFrames) {
      const elapsed = Date.now() - started;
      if (elapsed >= request.durationMs) break;

      const image = await window.webContents.capturePage();
      const bitmap = toFrameBitmap(image, request.maxWidth);
      frameWidth = bitmap.width;
      frameHeight = bitmap.height;

      const atMs = Date.now() - started;
      onFrame(bitmap, atMs);
      captureTimes.push(atMs);

      // Pace against absolute slots, not "sleep(interval)", so a slow capture
      // does not compound into progressive drift.
      nextSlot += frameInterval;
      const wait = nextSlot - Date.now();
      if (wait > 0) await sleep(wait);
    }

    if (captureTimes.length === 0) {
      throw new Error('No frames were captured.');
    }

    return {
      captureTimes,
      frameWidth,
      frameHeight,
      captureWidth: capture.width,
      captureHeight: capture.height,
    };
  } finally {
    // The window is a live compositor for as long as it exists; close it as
    // soon as capture ends rather than holding it open through the encode.
    if (window && !window.isDestroyed()) window.destroy();
  }
}
