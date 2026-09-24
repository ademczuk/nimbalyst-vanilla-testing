// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  boxBorder,
  isNormalState,
  stateTone,
  stateTransitions,
  transitionForProposal,
  transitionUpdates,
  type TrackerReferenceStatusOption,
} from '../trackerReferenceLifecycle';

const decisionStatuses: TrackerReferenceStatusOption[] = [
  { value: 'proposed', label: 'Proposed', category: 'unstarted' },
  { value: 'accepted', label: 'Accepted', category: 'done' },
  { value: 'rejected', label: 'Rejected', category: 'cancelled' },
  { value: 'superseded', label: 'Superseded', category: 'cancelled' },
];

const questionStatuses: TrackerReferenceStatusOption[] = [
  { value: 'open', label: 'Open', category: 'unstarted' },
  { value: 'investigating', label: 'Investigating', category: 'started' },
  { value: 'answered', label: 'Answered', category: 'done' },
  { value: 'deferred', label: 'Deferred', category: 'backlog' },
  { value: 'abandoned', label: 'Abandoned', category: 'cancelled' },
];

describe('stateTone', () => {
  it('maps each lifecycle status to the attention it needs', () => {
    const tones = Object.fromEntries([
      ['accepted', undefined], ['approved', 'started'], ['shipped', 'done'], ['answered', 'done'],
      ['building', 'started'], ['investigating', 'started'],
      ['proposed', 'unstarted'], ['in-review', 'unstarted'], ['changes-requested', 'unstarted'],
      ['rejected', 'cancelled'],
      ['superseded', 'cancelled'], ['abandoned', 'cancelled'], ['deferred', 'backlog'], ['parked', 'backlog'],
      ['open', 'unstarted'], ['draft', 'backlog'], ['todo', 'unstarted'],
    ].map(([value, category]) => [value, stateTone('x', { value: value!, category })]));
    expect(tones).toEqual({
      accepted: 'settled', approved: 'settled', shipped: 'settled', answered: 'settled',
      building: 'active', investigating: 'active',
      proposed: 'waiting', 'in-review': 'waiting', 'changes-requested': 'waiting',
      rejected: 'negative',
      superseded: 'parked', abandoned: 'parked', deferred: 'parked', parked: 'parked',
      open: 'open', draft: 'open', todo: 'open',
    });
    expect([boxBorder('waiting', false), boxBorder('settled', false), boxBorder('negative', false), boxBorder('active', true)])
      .toEqual(['dashed', 'solid', 'bare', 'solid']);
    expect([isNormalState('claim', 'asserted'), isNormalState('claim', 'disputed'), isNormalState('wiki-decision', 'accepted')])
      .toEqual([true, false, false]);
  });
});

describe('stateTransitions', () => {
  const actor = { email: 'sam@example.test', name: 'Sam' };

  it('answers a question only by accepting its proposed position', () => {
    const rows = stateTransitions({
      type: 'question', status: 'investigating', statusOptions: questionStatuses,
      position: 'Built in for the beta.', positionState: 'proposed', positionOwnerName: 'Karl', canOpenItem: true,
    });
    expect(rows.map((row) => row.id)).toEqual([
      'accept-position', 'write-position', 'status:open', 'status:deferred', 'status:abandoned',
    ]);
    expect(rows[0].label).toBe("Answered: accept Karl's position");
    expect(rows[2].separatorBefore).toBe(true);
    expect(transitionUpdates(rows[0], { actor, today: '2026-09-23' })).toEqual({
      status: 'answered', positionState: 'accepted', decidedBy: 'sam@example.test', decidedAt: '2026-09-23',
    });
    expect(transitionUpdates(rows[3], { actor, today: '2026-09-23', input: ' after the beta ' }))
      .toEqual({ status: 'deferred', revisitWhen: 'after the beta' });
    // A status proposal to "answered" runs the same accept row.
    expect(transitionForProposal(rows, 'answered')?.id).toBe('accept-position');

    const noPosition = stateTransitions({ type: 'question', status: 'open', statusOptions: questionStatuses });
    expect(noPosition.map((row) => row.toStatus)).toEqual(['investigating', 'deferred', 'abandoned']);
  });

  it('asks a decision rejection why not and records who decided', () => {
    const rows = stateTransitions({ type: 'wiki-decision', status: 'proposed', statusOptions: decisionStatuses });
    const reject = rows.find((row) => row.toStatus === 'rejected')!;
    expect(reject.prompt?.field).toBe('whyNot');
    expect(transitionUpdates(reject, { actor, today: '2026-09-23', input: 'Files cannot carry owners' })).toEqual({
      status: 'rejected', whyNot: 'Files cannot carry owners', decidedBy: 'sam@example.test', decidedAt: '2026-09-23',
    });
    const accept = rows.find((row) => row.toStatus === 'accepted')!;
    expect(transitionUpdates(accept, { actor: null, today: '2026-09-23' })).toEqual({ status: 'accepted' });
    // Superseding names the replacement, written as a relationship to the resolved item.
    const supersede = rows.find((row) => row.toStatus === 'superseded')!;
    expect(supersede.prompt?.field).toBe('supersededBy');
    expect(transitionUpdates(supersede, { actor, today: '2026-09-23', input: 'd-2' }))
      .toEqual({ status: 'superseded', supersededBy: { itemId: 'd-2' } });
  });
});
