/**
 * @vitest-environment node
 *
 * When the board card's staleness chip has something to say.
 *
 * The chip is a flag, never a write, and it can be wrong -- so what matters here
 * is that it stays silent unless a plan in one of the two provisional statuses has
 * a linked session that committed, and that it carries the commit and session
 * evidence through for the reader to judge.
 */

import { describe, it, expect } from 'vitest';
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import { resolvePlanStatusDriftPresentation } from '../trackerCardStaleness';

function planRecord(
  status: string,
  options: { primaryType?: string; withSessionCommit?: boolean } = {},
): TrackerRecord {
  return {
    id: 'plan_1',
    primaryType: options.primaryType ?? 'plan',
    typeTags: [options.primaryType ?? 'plan'],
    source: 'frontmatter',
    archived: false,
    syncStatus: 'local',
    system: {
      workspace: '/w',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      // A commit with no sessionId did not come through a session link, so it is
      // not evidence that a linked session committed.
      linkedCommits: [{
        sha: 'abc1234567890def',
        message: 'feat: land the thing',
        ...(options.withSessionCommit === false ? {} : { sessionId: 'ses_42' }),
        timestamp: '2026-08-10T00:00:00.000Z',
      }],
    },
    fields: { title: 'A plan', status },
  } as unknown as TrackerRecord;
}

describe('plan status drift presentation', () => {
  it('flags the two provisional statuses and nothing else', () => {
    expect(resolvePlanStatusDriftPresentation(planRecord('draft'))).not.toBeNull();
    expect(resolvePlanStatusDriftPresentation(planRecord('ready-for-development'))).not.toBeNull();

    for (const status of ['in-development', 'in-review', 'completed', 'rejected']) {
      expect(resolvePlanStatusDriftPresentation(planRecord(status))).toBeNull();
    }
  });

  it('stays silent for a draft with no committed session, and for other types', () => {
    expect(resolvePlanStatusDriftPresentation(
      planRecord('draft', { withSessionCommit: false }),
    )).toBeNull();
    expect(resolvePlanStatusDriftPresentation(
      planRecord('draft', { primaryType: 'bug' }),
    )).toBeNull();
  });

  it('hands over the commit and session evidence', () => {
    const drift = resolvePlanStatusDriftPresentation(planRecord('draft'));

    expect(drift?.commitShas).toEqual(['abc1234567890def']);
    expect(drift?.committedSessionIds).toEqual(['ses_42']);
  });
});
