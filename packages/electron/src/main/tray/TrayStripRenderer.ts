/**
 * Renders a `StripView` to a `NativeImage` for `tray.setImage()`.
 *
 * `Tray.setTitle` takes plain text only, so it can never show a coloured state
 * dot; the strip is a real render instead. A hidden `BrowserWindow` loads the
 * mockup's markup, `capturePage()` reads back the laid-out pixels, and the
 * result goes straight onto the tray.
 *
 * The costs are known and paid for here:
 *
 * - The window is created lazily on the first non-trivial render and torn down
 *   with the tray, so a machine that never runs a session never makes one.
 * - Every render is a round trip, so results are cached by `stripViewKey` and an
 *   unchanged view never touches the window. A `capturePage()` per
 *   `session:streaming` tick is not acceptable.
 * - The image is NOT a template image (it has colour), so macOS will not tint
 *   it -- see the palette note in stripMarkup.ts.
 */

import { BrowserWindow, nativeImage } from 'electron';
import { logger } from '../utils/logger';
import { loadTrayGlyphDataUri } from './trayGlyph';
import { STRIP_HEIGHT, STRIP_MAX_WIDTH, renderStripBody, stripDocumentHtml } from './stripMarkup';
import { stripViewKey, type StripView } from './stripStateMachine';

/**
 * Re-tag a captured page at the scale factor it was actually rendered at.
 *
 * `capturePage` hands back a retina bitmap reporting `scaleFactors: [1]`, so a
 * 16pt-tall request comes out claiming to be 32 points tall. Handed to the tray
 * unchanged, macOS scales that down to fit the 22pt status bar and the strip is
 * both oversized and soft. Deriving the factor from the returned height (rather
 * than hardcoding 2) keeps a non-retina external display correct.
 *
 * The bitmap round trip is lossless: `toBitmap` and `createFromBuffer` are both
 * BGRA on macOS, which is the same pairing `getIconForState` already relies on.
 */
function atDisplayScale(captured: Electron.NativeImage): Electron.NativeImage {
  const size = captured.getSize();
  const scaleFactor = size.height / STRIP_HEIGHT;
  if (!Number.isFinite(scaleFactor) || scaleFactor <= 1) return captured;
  return nativeImage.createFromBuffer(captured.toBitmap(), {
    width: size.width,
    height: size.height,
    scaleFactor,
  });
}

export class TrayStripRenderer {
  private window: BrowserWindow | null = null;
  private loading: Promise<BrowserWindow | null> | null = null;
  private glyphDataUri: string | null = null;
  private lastKey: string | null = null;
  private lastImage: Electron.NativeImage | null = null;
  /** Renders are serialised: two capturePage calls into one window race. */
  private queue: Promise<unknown> = Promise.resolve();

  async render(view: StripView): Promise<Electron.NativeImage | null> {
    const key = stripViewKey(view);
    if (key === this.lastKey && this.lastImage) return this.lastImage;

    const result = this.queue.then(() => this.renderNow(view, key));
    // Keep the chain alive even when one render fails.
    this.queue = result.catch(() => undefined);
    return result;
  }

  destroy(): void {
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
    this.loading = null;
    this.lastKey = null;
    this.lastImage = null;
  }

  private async renderNow(view: StripView, key: string): Promise<Electron.NativeImage | null> {
    if (key === this.lastKey && this.lastImage) return this.lastImage;

    const window = await this.ensureWindow();
    if (!window || window.isDestroyed()) return null;

    try {
      const body = renderStripBody(view);
      const width: number = await window.webContents.executeJavaScript(
        `window.__nimSetStrip(${JSON.stringify(body)})`,
        true,
      );
      if (!Number.isFinite(width) || width <= 0) return null;

      const captured = await window.webContents.capturePage({
        x: 0,
        y: 0,
        width: Math.min(Math.ceil(width), STRIP_MAX_WIDTH),
        height: STRIP_HEIGHT,
      });
      if (captured.isEmpty()) {
        logger.main.warn('[TrayStripRenderer] capturePage returned an empty image');
        return null;
      }

      const image = atDisplayScale(captured);
      // Must NOT be a template image -- the strip is the colour.
      image.setTemplateImage(false);

      this.lastKey = key;
      this.lastImage = image;
      return image;
    } catch (error) {
      logger.main.error('[TrayStripRenderer] Failed to render the menu bar strip:', error);
      return null;
    }
  }

  private ensureWindow(): Promise<BrowserWindow | null> {
    if (this.window && !this.window.isDestroyed()) return Promise.resolve(this.window);
    if (this.loading) return this.loading;

    this.loading = this.createWindow().catch((error) => {
      logger.main.error('[TrayStripRenderer] Failed to create the offscreen strip window:', error);
      this.loading = null;
      return null;
    });
    return this.loading;
  }

  private async createWindow(): Promise<BrowserWindow> {
    const window = new BrowserWindow({
      show: false,
      width: STRIP_MAX_WIDTH,
      height: STRIP_HEIGHT,
      frame: false,
      transparent: true,
      hasShadow: false,
      skipTaskbar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        // A hidden window is throttled, and a throttled window never runs the
        // requestAnimationFrame that tells us the strip has painted.
        backgroundThrottling: false,
      },
    });

    window.on('closed', () => {
      this.window = null;
      this.loading = null;
    });

    const html = stripDocumentHtml(this.loadGlyphDataUri());
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

    this.window = window;
    return window;
  }

  /** Shared with the island, so the two strip styles carry the same mark. */
  private loadGlyphDataUri(): string {
    if (!this.glyphDataUri) this.glyphDataUri = loadTrayGlyphDataUri();
    return this.glyphDataUri;
  }
}
