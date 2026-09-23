import { describe, expect, it } from 'vitest';
import { planTrackerIdentityRecovery } from '../trackerIdentityRecovery';

const BASE = {
  strandedCount: 0,
  minStrandedSyncId: 0,
  localMaxSyncId: 0,
  alreadyAttempted: false,
};

describe('planTrackerIdentityRecovery', () => {
  it('rewinds to just below the oldest stranded row so that row is re-sent', () => {
    // The server filters with `syncId > sinceSyncId`, so asking from the row's
    // own sync_id would skip the one row the whole pass exists to repair.
    expect(planTrackerIdentityRecovery({
      ...BASE, strandedCount: 17, minStrandedSyncId: 1352, localMaxSyncId: 31857,
    })).toEqual({
      action: 'resync', sinceSyncId: 1351, strandedCount: 17, rewindDistance: 30506,
    });
  });

  it('does not rewind for a stranded row the ordinary bootstrap already covers', () => {
    // At or above the cursor the row is in the next delta anyway, and rewinding
    // to it would re-request the tail for nothing.
    expect(planTrackerIdentityRecovery({
      ...BASE, strandedCount: 1, minStrandedSyncId: 900, localMaxSyncId: 900,
    })).toEqual({ action: 'none', reason: 'cursor-not-ahead' });
  });

  it('runs once per workspace', () => {
    // The rewind is thousands of rows on a mature workspace. A pass that keeps
    // firing because the room cannot re-assert those rows is worse than one
    // repair that did not take.
    expect(planTrackerIdentityRecovery({
      ...BASE, strandedCount: 17, minStrandedSyncId: 1352, localMaxSyncId: 31857,
      alreadyAttempted: true,
    })).toEqual({ action: 'none', reason: 'already-attempted' });
  });

  it('stays clear of a negative cursor when the first row itself is stranded', () => {
    expect(planTrackerIdentityRecovery({
      ...BASE, strandedCount: 1, minStrandedSyncId: 0, localMaxSyncId: 10,
    })).toMatchObject({ action: 'resync', sinceSyncId: 0 });
  });

  it('does nothing when there is nothing stranded', () => {
    expect(planTrackerIdentityRecovery({ ...BASE, localMaxSyncId: 31857 }))
      .toEqual({ action: 'none', reason: 'no-stranded-rows' });
  });
});
