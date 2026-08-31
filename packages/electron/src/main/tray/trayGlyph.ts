/**
 * The tray template PNG, inlined as a data URI.
 *
 * Shared by both fleet-strip render styles so they cannot drift: the bitmap
 * strip masks it into a `data:` document that cannot reach `file://`, and the
 * island is a separate renderer that has no filesystem access at all. Cached --
 * the file never changes while the app runs.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { app, nativeImage } from 'electron';
import { getPackageRoot } from '../utils/appPaths';
import { logger } from '../utils/logger';

let cached: string | null = null;

export function loadTrayGlyphDataUri(): string {
  if (cached) return cached;

  const resourcesDir = app.isPackaged
    ? process.resourcesPath
    : path.join(getPackageRoot(), 'resources');

  try {
    const bytes = readFileSync(path.join(resourcesDir, 'trayTemplate@2x.png'));
    cached = `data:image/png;base64,${bytes.toString('base64')}`;
  } catch (error) {
    logger.main.warn('[trayGlyph] Could not inline the tray glyph:', error);
    // A strip with counts and no glyph still answers the question; a strip that
    // fails to render answers nothing.
    cached = nativeImage.createEmpty().toDataURL();
  }
  return cached;
}
