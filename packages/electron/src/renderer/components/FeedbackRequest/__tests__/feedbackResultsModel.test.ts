// @vitest-environment node
/**
 * Two things the results model has to get right that no one can see on screen:
 *
 * - the ranked consolidation flags a genuinely contested item and leaves a
 *   consensus item alone. A bare mean would rank both identically, so the flag
 *   is the whole reason this surface is not a table of averages.
 * - a `hiddenUntilAnswered` request never produces attribution, and outstanding
 *   people are never named on one -- naming who is missing from a small
 *   anonymous poll identifies the answers already in.
 */

import { describe, expect, it } from 'vitest';
import type { FeedbackRequestReadModel } from '@nimbalyst/collab-protocol';

import {
  buildFeedbackResults,
  consolidateRankedAnswers,
  type FeedbackRankedResult,
} from '../feedbackResultsModel';

const ITEMS = [
  { id: 'keyboard', title: 'Keyboard navigation' },
  { id: 'inline', title: 'Inline editing' },
  { id: 'presence', title: 'Live presence' },
];

function entry(result: FeedbackRankedResult, itemId: string) {
  const found = result.entries.find((candidate) => candidate.itemId === itemId);
  if (!found) throw new Error(`No consolidated entry for ${itemId}`);
  return found;
}

describe('consolidateRankedAnswers', () => {
  it('flags the split item and not the ones everyone agrees on', () => {
    // Three voters put inline editing last, one puts it first: the mean lands
    // it mid-table looking unremarkable, which is exactly the disagreement the
    // author has to see.
    const result = consolidateRankedAnswers(ITEMS, [
      ['keyboard', 'presence', 'inline'],
      ['keyboard', 'presence', 'inline'],
      ['inline', 'keyboard', 'presence'],
      ['keyboard', 'inline', 'presence'],
    ]);

    expect(entry(result, 'inline').contested).toBe(true);
    expect(entry(result, 'keyboard').contested).toBe(false);
    expect(entry(result, 'presence').contested).toBe(false);
    expect(result.entries[0].itemId).toBe('keyboard');
  });

  it('does not call a lone dissenter in a large pool contested', () => {
    const orderings = [
      ...Array.from({ length: 7 }, () => ['keyboard', 'inline', 'presence']),
      ['presence', 'inline', 'keyboard'],
    ];
    const result = consolidateRankedAnswers(ITEMS, orderings);

    expect(entry(result, 'keyboard').contested).toBe(false);
    expect(entry(result, 'keyboard')).toMatchObject({
      firstPlaceCount: 7,
      rankedByCount: 8,
    });
  });

  it('needs two orderings before anything can be contested', () => {
    const result = consolidateRankedAnswers(ITEMS, [['inline', 'keyboard', 'presence']]);
    expect(result.entries.every((item) => !item.contested)).toBe(true);
    expect(result.orderingCount).toBe(1);
  });

  it('treats a removed item as unranked rather than ranked last', () => {
    const result = consolidateRankedAnswers(ITEMS, [
      ['keyboard', 'inline'],
      ['keyboard', 'inline'],
    ]);
    const presence = entry(result, 'presence');

    expect(presence.rankedByCount).toBe(0);
    expect(presence.lastPlaceCount).toBe(0);
    // No mean, so it sorts to the bottom instead of tying for first.
    expect(result.entries[result.entries.length - 1].itemId).toBe('presence');
  });
});

// ---------------------------------------------------------------------------

const AUTHOR = 'u-greg';
const KARL = 'u-karl';
const DANA = 'u-dana';

function makeRequest(
  visibility: FeedbackRequestReadModel['visibility'],
  attributedResponses: boolean,
): FeedbackRequestReadModel {
  return {
    id: 'req-1',
    urn: 'nimbalyst://feedback-request/req-1',
    orgId: 'org-1',
    author: { kind: 'user', userId: AUTHOR, onBehalfOfUserId: AUTHOR },
    subjects: [],
    asks: [
      {
        type: 'singleSelect',
        id: 'ask-direction',
        label: 'Direction',
        description: 'Which one?',
        options: [
          { id: 'a', label: 'A · Split panel' },
          { id: 'b', label: 'B · Radial' },
        ],
      },
    ],
    recipients: [
      { userId: KARL, name: 'Karl Ito' },
      { userId: DANA, name: 'Dana Ok' },
    ],
    assignments: [
      { askId: 'ask-direction', target: { kind: 'user', userId: KARL } },
      { askId: 'ask-direction', target: { kind: 'user', userId: DANA } },
    ],
    responses: [
      {
        id: 'res-1',
        requestId: 'req-1',
        askId: 'ask-direction',
        // A hidden request arrives without this field. It is set here anyway in
        // the hidden case so the test proves the client gate holds even if the
        // server one ever stopped.
        ...(attributedResponses ? { recipientUserId: KARL } : {}),
        answer: { type: 'singleSelect', selectedId: 'b' },
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    discussion: [],
    lifecycle: { status: 'open', changedAt: 0 },
    visibility,
    wakePolicy: 'quorumOrClose',
    quorum: { requiredRecipientCount: 2 },
    createdAt: 0,
    updatedAt: 1,
  };
}

describe('buildFeedbackResults attribution', () => {
  it('attributes an open request', () => {
    const results = buildFeedbackResults(makeRequest('open', true), {
      answeredAskCount: 1,
      totalAssignedAskCount: 2,
      answeredRecipientCount: 1,
      totalRecipientCount: 2,
      quorumReached: false,
    });
    const detail = results.askResults[0].detail;
    if (detail.kind !== 'choice') throw new Error('expected a choice tally');

    expect(results.attributed).toBe(true);
    expect(detail.options.find((option) => option.optionId === 'b')?.voters)
      .toEqual([{ userId: KARL, name: 'Karl Ito', initials: 'KI' }]);
    expect(results.outstanding).toEqual({
      kind: 'named',
      count: 1,
      people: [{
        userId: DANA,
        name: 'Dana Ok',
        initials: 'DO',
        pendingAskLabels: ['Direction'],
      }],
    });
  });

  it('does not mask an attributed response if the server violates hidden projection', () => {
    const results = buildFeedbackResults(makeRequest('hiddenUntilAnswered', true), {
      answeredAskCount: 1,
      totalAssignedAskCount: 2,
      answeredRecipientCount: 1,
      totalRecipientCount: 2,
      quorumReached: false,
    });
    const detail = results.askResults[0].detail;
    if (detail.kind !== 'choice') throw new Error('expected a choice tally');

    expect(results.attributed).toBe(false);
    expect(detail.options.find((option) => option.optionId === 'b')?.voters)
      .toEqual([{ userId: KARL, name: 'Karl Ito', initials: 'KI' }]);
    // The count still lands; only the who is withheld.
    expect(detail.options.find((option) => option.optionId === 'b')?.count).toBe(1);
    expect(results.outstanding).toEqual({ kind: 'anonymous', count: 1 });
  });
});
