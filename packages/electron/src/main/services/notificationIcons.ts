/**
 * Per-kind artwork for OS notifications.
 *
 * Platform reality, verified against Electron 43 on macOS: `icon` becomes a
 * `UNNotificationAttachment`, which the OS renders as the small preview image on
 * the *right* of the banner. The large icon on the left is always the app icon
 * and cannot be varied per notification. On Windows the same value overrides the
 * toast app-logo. So the kind is a secondary signal everywhere, never the only
 * way to tell two notifications apart -- the title still has to carry the
 * meaning.
 */

import { app } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { getPackageRoot } from '../utils/appPaths';
import { logger } from '../utils/logger';

export type NotificationKind =
  /** An agent finished a turn and has something to read. */
  | 'agent-complete'
  /** An agent asked the user a question and is waiting on the answer. */
  | 'agent-question'
  /** An agent is stopped until the user approves or permits something. */
  | 'needs-input'
  /** A Nimbalyst Teams message or inbox delivery. */
  | 'teams-message';

const ICON_BASE_NAMES: Record<NotificationKind, string> = {
  'agent-complete': 'agent-complete',
  'agent-question': 'agent-question',
  'needs-input': 'needs-input',
  'teams-message': 'teams-message',
};

export const NOTIFICATION_KINDS = Object.keys(ICON_BASE_NAMES) as NotificationKind[];

/**
 * Filename under `resources/notifications/` for a kind on a given platform.
 * Packaged builds get the same directory copied to `<Resources>/notifications`
 * via `extraResources`.
 *
 * Windows gets its own artwork because there the icon lands in the toast's
 * `appLogoOverride` slot -- it *replaces* the Nimbalyst logo, so the Windows
 * variants carry the mark with the status as a badge. macOS and Linux show the
 * app icon separately, so those variants are the status glyph alone.
 */
export function notificationIconFileName(
  kind: NotificationKind,
  platform: NodeJS.Platform = process.platform,
): string {
  const base = ICON_BASE_NAMES[kind];
  return platform === 'win32' ? `${base}-win.png` : `${base}.png`;
}

const resolvedPaths = new Map<NotificationKind, string | null>();

export function getNotificationIconsDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'notifications')
    : path.join(getPackageRoot(), 'resources', 'notifications');
}

/**
 * Absolute path to the icon for a kind, or undefined when there is nothing to
 * show. A missing file is not fatal -- the notification still goes out with the
 * default app artwork -- but it is logged once per kind, because a silently
 * icon-less toast looks identical to one whose asset never got packaged.
 */
export function resolveNotificationIcon(kind?: NotificationKind): string | undefined {
  if (!kind) return undefined;

  const cached = resolvedPaths.get(kind);
  if (cached !== undefined) return cached ?? undefined;

  const file = path.join(getNotificationIconsDir(), notificationIconFileName(kind));
  const exists = existsSync(file);
  if (!exists) {
    logger.main.warn(`[notificationIcons] Missing icon for "${kind}" at ${file}`);
  }
  resolvedPaths.set(kind, exists ? file : null);
  return exists ? file : undefined;
}

/** Test seam: the resolution cache outlives a single test file otherwise. */
export function clearNotificationIconCache(): void {
  resolvedPaths.clear();
}
