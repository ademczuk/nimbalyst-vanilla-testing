// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  reconcileIssueKeyOnPublish,
  resolveTrackerPromotionEligibility,
  resolveTrackerWriteAccess,
  TrackerIssueKeyRewriteError,
} from '../trackerLifecycle';

describe('reconcileIssueKeyOnPublish', () => {
  it('mints a key for a draft that has none', () => {
    expect(reconcileIssueKeyOnPublish({ itemId: 'i1', mintedKey: 'NIM-42' }))
      .toEqual({ issueKey: 'NIM-42', minted: true });
  });

  // The expensive failure this guards: promotion sweeps every item, including
  // ones already published. Adopting a second server key there would renumber
  // an item people have already cited by key.
  it('keeps an existing key rather than minting a second one', () => {
    expect(reconcileIssueKeyOnPublish({ itemId: 'i1', existingKey: 'NIM-7', mintedKey: 'NIM-7' }))
      .toEqual({ issueKey: 'NIM-7', minted: false });
    expect(reconcileIssueKeyOnPublish({ itemId: 'i1', existingKey: 'NIM-7' }))
      .toEqual({ issueKey: 'NIM-7', minted: false });
  });

  it('refuses to rewrite a key that disagrees with the room', () => {
    expect(() => reconcileIssueKeyOnPublish({ itemId: 'i1', existingKey: 'NIM-7', mintedKey: 'NIM-9' }))
      .toThrow(TrackerIssueKeyRewriteError);
  });

  // Publishing while offline: the room has not answered yet. That is pending,
  // not an assigned key, and must not be reported as one.
  it('leaves the item unkeyed when the room has not answered', () => {
    expect(reconcileIssueKeyOnPublish({ itemId: 'i1' })).toEqual({ issueKey: undefined, minted: false });
  });
});

describe('resolveTrackerPromotionEligibility', () => {
  it('promotes a personal tracker and keeps the same action available to finish a partial sweep', () => {
    expect(resolveTrackerPromotionEligibility({ sharing: 'personal' })).toMatchObject({
      canPromote: true,
      mode: 'promote',
    });

    const team = resolveTrackerPromotionEligibility({ sharing: 'team' });
    expect(team).toMatchObject({ canPromote: true, mode: 'resume' });
    expect(team.message).toMatch(/finish|again/i);
  });

  it('does not offer an archived tracker to the team', () => {
    const archived = resolveTrackerPromotionEligibility({ sharing: 'personal', archived: true });
    expect(archived.canPromote).toBe(false);
    expect(archived.blockedReason).toBe('archived');
  });
});

describe('resolveTrackerWriteAccess', () => {
  it('makes an archived tracker read-only and nothing else', () => {
    const active = resolveTrackerWriteAccess({ displayNamePlural: 'Bugs' });
    expect(active.canWrite).toBe(true);
    expect(active.readOnlyReason).toBeUndefined();

    const archived = resolveTrackerWriteAccess({ displayNamePlural: 'Bugs', archived: true });
    expect(archived.canWrite).toBe(false);
    // Retention is the point of D4: the reason must promise the items are kept,
    // because "archived" otherwise reads as "deleted".
    expect(archived.readOnlyReason).toMatch(/kept/i);
    expect(archived.readOnlyReason).not.toMatch(/delete|remove/i);
  });
});
