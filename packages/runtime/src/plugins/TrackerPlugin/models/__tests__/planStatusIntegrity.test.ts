// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseBuiltinTrackers } from '../ModelLoader';
import {
  derivePlanStatusSignals,
  normalizePlanStatusForProjection,
} from '../planStatusIntegrity';

const committedPlanInput = {
  primaryType: 'plan',
  status: 'draft',
  linkedCommits: [
    {
      sha: 'cf2cb92aa',
      message: 'feat: ship the plan',
      sessionId: 'session-with-commit',
      timestamp: '2026-08-10T12:00:00.000Z',
    },
  ],
};

describe('plan status integrity', () => {
  it('flags a draft plan when one of its linked sessions committed', () => {
    expect(derivePlanStatusSignals(committedPlanInput)).toEqual([
      {
        kind: 'plan-status-drift',
        reason: 'linked-session-committed',
        status: 'draft',
        committedSessionIds: ['session-with-commit'],
        commitShas: ['cf2cb92aa'],
      },
    ]);

    expect(derivePlanStatusSignals({
      ...committedPlanInput,
      status: 'ready-for-development',
    })[0]?.status).toBe('ready-for-development');
  });

  it('does not flag a plan whose linked session has not committed', () => {
    expect(derivePlanStatusSignals({
      ...committedPlanInput,
      linkedCommits: [],
    })).toEqual([]);

    expect(derivePlanStatusSignals({
      ...committedPlanInput,
      linkedCommits: [{
        ...committedPlanInput.linkedCommits[0],
        sessionId: undefined,
      }],
    })).toEqual([]);
  });

  it('does not flag a plan after its status reflects active implementation', () => {
    expect(derivePlanStatusSignals({
      ...committedPlanInput,
      status: 'in-development',
    })).toEqual([]);
  });

  it('maps git-changes-tab-density-mask-commit complete to the real plan schema value', () => {
    const planModel = parseBuiltinTrackers().find((model) => model.type === 'plan');
    const statusOptions = planModel?.fields
      .find((field) => field.name === 'status')
      ?.options
      ?.map((option) => option.value) ?? [];

    expect(statusOptions).toContain('completed');
    expect(statusOptions).not.toContain('complete');
    expect(normalizePlanStatusForProjection('complete', statusOptions)).toEqual({
      status: 'completed',
      valid: true,
      normalizedFrom: 'complete',
    });
  });

  it('preserves an unknown status for a read-only projection warning', () => {
    expect(normalizePlanStatusForProjection('finished', ['draft', 'completed'])).toEqual({
      status: 'finished',
      valid: false,
    });
  });
});
