/**
 * The bridge for the hidden window that encodes an animation to H.264.
 *
 * Deliberately thin: it moves frames in and encoded chunks out, and nothing
 * else. The encoding itself is injected into the page's main world, where
 * WebCodecs is unambiguously present -- an isolated world is not the documented
 * home of `VideoEncoder`, and this is not a good place to find out.
 *
 * Frames that arrive before the page has registered its handler are buffered
 * rather than dropped. Capture starts as soon as main says so and does not wait
 * for a renderer to finish setting itself up.
 */

import { contextBridge, ipcRenderer } from 'electron';

export interface VideoFramePayload {
  data: Uint8Array;
  codedWidth: number;
  codedHeight: number;
  visibleWidth: number;
  visibleHeight: number;
  timestampUs: number;
  durationUs: number;
}

type FrameHandler = (frame: VideoFramePayload) => void;

const buffered: VideoFramePayload[] = [];
let frameHandler: FrameHandler | null = null;
let endHandler: (() => void) | null = null;
let ended = false;

ipcRenderer.on('animation-video:frame', (_event, frame: VideoFramePayload) => {
  if (frameHandler) frameHandler(frame);
  else buffered.push(frame);
});

ipcRenderer.on('animation-video:end', () => {
  if (endHandler) endHandler();
  else ended = true;
});

contextBridge.exposeInMainWorld('animationVideoBridge', {
  start(onFrame: FrameHandler, onEnd: () => void) {
    frameHandler = onFrame;
    endHandler = onEnd;
    for (const frame of buffered.splice(0)) onFrame(frame);
    if (ended) {
      ended = false;
      onEnd();
    }
  },
  chunk(payload: unknown) {
    ipcRenderer.send('animation-video:chunk', payload);
  },
  done() {
    ipcRenderer.send('animation-video:done');
  },
  fail(message: string) {
    ipcRenderer.send('animation-video:error', message);
  },
});
