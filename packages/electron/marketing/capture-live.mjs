/**
 * Capture a screenshot of an editor in the RUNNING dev app, over CDP.
 *
 * The marketing/specs pipeline launches its own Electron; that launch currently
 * hangs in main-process init, so this drives the app the user already has open.
 *
 * Two things make naive selection wrong, and both cost a debugging round:
 * several Nimbalyst windows share the debugging port, and every mode component
 * stays mounted under `display: none` — so a workspace with two canvas tabs has
 * two `.canvas-editor` elements and `querySelector` hands back the hidden one.
 * The visible element is therefore chosen by measured size, not by order.
 *
 * The window must already be in Files mode with the target tab active.
 *
 * Usage:
 *   node marketing/capture-live.mjs <selector> <out.png>
 */
import { chromium } from 'playwright';

const [selector, outPath] = process.argv.slice(2);
if (!selector || !outPath) {
  console.error('usage: capture-live.mjs <selector> <out.png>');
  process.exit(1);
}

const MARKER = '__nim_capture_target';
const browser = await chromium.connectOverCDP('http://localhost:9222');

let target = null;
for (const context of browser.contexts()) {
  for (const page of context.pages()) {
    const size = await page
      .evaluate(
        ({ sel, marker }) => {
          const visible = [...document.querySelectorAll(sel)].find((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 200 && r.height > 200;
          });
          if (!visible) return null;
          visible.id = marker;
          const r = visible.getBoundingClientRect();
          return { w: Math.round(r.width), h: Math.round(r.height) };
        },
        { sel: selector, marker: MARKER }
      )
      .catch(() => null);
    if (size) {
      target = { page, size };
      break;
    }
  }
  if (target) break;
}

if (!target) {
  console.error(`no visible ${selector} on any page (is the window in Files mode with the tab active?)`);
  await browser.close();
  process.exit(2);
}

await target.page.locator(`#${MARKER}`).screenshot({ path: outPath });
await target.page.evaluate((marker) => {
  const el = document.getElementById(marker);
  if (el) el.removeAttribute('id');
}, MARKER);

console.log(`captured ${selector} ${target.size.w}x${target.size.h} -> ${outPath}`);
await browser.close();
