import type { ConfirmDialogOptions } from '../../../contexts/DialogContext.types';
import type { TrackerSharing } from '@nimbalyst/runtime';

export const LOCAL_TRACKER_CONFIG_LOCATION = '.nimbalyst/trackers/*.yaml';
export const SHARED_TRACKER_CONFIG_LOCATION = 'the shared Cloudflare-hosted tracker database';

export function isTeamTrackerSharing(sharing: TrackerSharing): boolean {
  return sharing === 'team';
}

export function requiresTrackerSharingConfirmation(
  currentSharing: TrackerSharing,
  nextSharing: TrackerSharing,
): boolean {
  return currentSharing === 'personal' && isTeamTrackerSharing(nextSharing);
}

export function canChangeTrackerSharing(
  currentSharing: TrackerSharing,
  nextSharing: TrackerSharing,
  isAdmin: boolean,
): boolean {
  return !requiresTrackerSharingConfirmation(currentSharing, nextSharing) || isAdmin;
}

export function getTrackerStorageCopy(): string {
  return `Local tracker config is stored in ${LOCAL_TRACKER_CONFIG_LOCATION}. Shared tracker config is stored in ${SHARED_TRACKER_CONFIG_LOCATION}.`;
}

export function buildTrackerSharingConfirmOptions(
  trackerDisplayNamePlural: string,
  _nextSharing: TrackerSharing,
): ConfirmDialogOptions {
  return {
    title: `Share ${trackerDisplayNamePlural} with the team?`,
    message: `${trackerDisplayNamePlural} currently use local YAML config from ${LOCAL_TRACKER_CONFIG_LOCATION}. Proceeding will move this tracker config into ${SHARED_TRACKER_CONFIG_LOCATION}. The resulting Kanban config will keep the union of every column already in use, and all tracker items will be preserved. Afterward, you can use your agent to move items, consolidate columns, and delete any extra columns.`,
    confirmLabel: 'Proceed',
    cancelLabel: 'Cancel',
  };
}
