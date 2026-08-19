// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  buildTrackerSharingConfirmOptions,
  canChangeTrackerSharing,
  getTrackerStorageCopy,
  requiresTrackerSharingConfirmation,
} from '../trackerConfigUpgrade';

describe('trackerConfigUpgrade', () => {
  it('requires confirmation when promoting a personal tracker to the team', () => {
    expect(requiresTrackerSharingConfirmation('personal', 'team')).toBe(true);
  });

  it('does not require confirmation for unchanged or non-upgrade mode changes', () => {
    expect(requiresTrackerSharingConfirmation('personal', 'personal')).toBe(false);
    expect(requiresTrackerSharingConfirmation('team', 'team')).toBe(false);
    expect(requiresTrackerSharingConfirmation('team', 'personal')).toBe(false);
  });

  it('allows local-to-shared upgrades only for admins', () => {
    expect(canChangeTrackerSharing('personal', 'team', true)).toBe(true);
    expect(canChangeTrackerSharing('personal', 'team', false)).toBe(false);
    expect(canChangeTrackerSharing('team', 'personal', false)).toBe(true);
  });

  it('describes where local and shared tracker config are stored', () => {
    expect(getTrackerStorageCopy()).toContain('.nimbalyst/trackers/*.yaml');
    expect(getTrackerStorageCopy()).toContain('shared Cloudflare-hosted tracker database');
  });

  it('builds the required local-to-shared confirmation copy', () => {
    const options = buildTrackerSharingConfirmOptions('Bugs', 'team');

    expect(options.title).toContain('Share Bugs with the team?');
    expect(options.confirmLabel).toBe('Proceed');
    expect(options.cancelLabel).toBe('Cancel');
    expect(options.message).toContain('local YAML config');
    expect(options.message).toContain('.nimbalyst/trackers/*.yaml');
    expect(options.message).toContain('shared Cloudflare-hosted tracker database');
    expect(options.message).toContain('union of every column already in use');
    expect(options.message).toContain('all tracker items will be preserved');
    expect(options.message).toContain('use your agent to move items, consolidate columns, and delete any extra columns');
  });
});
