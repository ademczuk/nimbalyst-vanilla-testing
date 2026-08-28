// @vitest-environment node

/**
 * Tier promotion and the unshared-subject publish gate.
 *
 * Both are invisible on screen: the compose surface looks like one card either
 * way, and "we did not publish anything" leaves no visible trace. They are also
 * the two rules the slice exists to enforce, so they are tested here rather
 * than through the widget.
 */

import { describe, expect, it } from 'vitest';
import type { FeedbackAsk, FeedbackRequestRecipient } from '@nimbalyst/collab-protocol';
import {
  addRecipient,
  confirmPublish,
  createEmptyFeedbackComposeDraft,
  describeDestination,
  destinationSubjects,
  FEEDBACK_DEFAULT_DESTINATION_NAME,
  feedbackComposeSendPayload,
  feedbackComposeSubmitPlan,
  feedbackComposeTier,
  feedbackComposeTierPromotionReasons,
  removeRecipient,
  setDeadline,
  setDestination,
  setVisibility,
  toggleAssignment,
  type FeedbackComposeDraft,
  type FeedbackComposeSubject,
} from '../feedback/feedbackComposeDraft';
import { parseRequestFeedbackToolResult } from '../feedback/parseFeedbackComposeArgs';

const KARL: FeedbackRequestRecipient = { userId: 'u-karl', name: 'Karl Reyes' };
const DANA: FeedbackRequestRecipient = { userId: 'u-dana', name: 'Dana Ok' };

const PICK_ONE: FeedbackAsk = {
  type: 'singleSelect',
  id: 'ask-direction',
  label: 'Direction',
  description: 'Which of these should we build?',
  options: [
    { id: 'a', label: 'A · Split panel' },
    { id: 'b', label: 'B · Radial' },
  ],
};

function subject(sourceId: string, shared: boolean): FeedbackComposeSubject {
  return {
    ref: { orgId: 'org-1', kind: 'file', sourceId },
    label: `${sourceId}.mockup.html`,
    shared,
  };
}

/** One recipient, one ask assigned to them, nothing else: Tier 1. */
function quickDraft(): FeedbackComposeDraft {
  return {
    ...createEmptyFeedbackComposeDraft('draft-1', 'org-1'),
    asks: [PICK_ONE],
    recipients: [KARL],
    assignments: [{ askId: PICK_ONE.id, target: { kind: 'user', userId: KARL.userId } }],
  };
}

describe('feedback compose — tier promotion', () => {
  it('stays at Tier 1 for one recipient with nothing else set', () => {
    const draft = quickDraft();
    expect(feedbackComposeTierPromotionReasons(draft)).toEqual([]);
    expect(feedbackComposeTier(draft)).toBe('quick');
  });

  it('promotes on a second recipient, a deadline, or an unshared subject', () => {
    expect(feedbackComposeTier(addRecipient(quickDraft(), DANA))).toBe('full');
    expect(feedbackComposeTier(setDeadline(quickDraft(), 1_800_000_000_000))).toBe('full');
    expect(
      feedbackComposeTier({ ...quickDraft(), subjects: [subject('direction-a', false)] }),
    ).toBe('full');
  });

  it('does not promote for a subject that is already shared', () => {
    expect(
      feedbackComposeTier({ ...quickDraft(), subjects: [subject('direction-c', true)] }),
    ).toBe('quick');
  });

  it('expanding the settings panel is presentation only and does not promote', () => {
    expect(feedbackComposeTier({ ...quickDraft(), settingsExpanded: true })).toBe('quick');
  });

  it('keeps what the author entered when the trigger is removed', () => {
    // Author goes to Tier 2, changes a Tier-2-only setting, then backs out.
    let draft = addRecipient(quickDraft(), DANA);
    draft = setVisibility(draft, 'open');
    draft = setDeadline(draft, 1_800_000_000_000);
    expect(feedbackComposeTier(draft)).toBe('full');

    draft = setDeadline(draft, undefined);
    expect(feedbackComposeTier(draft)).toBe('full'); // still two recipients

    draft = removeRecipient(draft, DANA.userId);
    expect(feedbackComposeTier(draft)).toBe('quick');

    // The visibility choice survives demotion and re-promotion rather than
    // silently reverting to the default.
    expect(draft.visibility).toBe('open');
    expect(addRecipient(draft, DANA).visibility).toBe('open');
  });

  it('removing a recipient drops only their assignments, never the asks', () => {
    const draft = removeRecipient(addRecipient(quickDraft(), DANA), DANA.userId);
    expect(draft.asks.map((ask) => ask.id)).toEqual([PICK_ONE.id]);
    expect(draft.assignments).toEqual([
      { askId: PICK_ONE.id, target: { kind: 'user', userId: KARL.userId } },
    ]);
  });
});

describe('feedback compose — submit plan', () => {
  it('treats a returned MCP draft as pending author review, including sharing and quorum state', () => {
    const parsed = parseRequestFeedbackToolResult(JSON.stringify({
      status: 'draftReady',
      draft: {
        orgId: 'org-1',
        asks: [PICK_ONE],
        recipients: [KARL],
        assignments: [{ askId: PICK_ONE.id, target: { kind: 'user', userId: KARL.userId } }],
        subjects: [subject('direction-a', false)],
        visibility: 'open',
        quorumMode: 'first',
      },
    }), 'tool-call-1');

    expect(parsed).toMatchObject({
      status: 'draftReady',
      draft: {
        draftId: 'tool-call-1',
        visibility: 'open',
        quorumMode: 'first',
        subjects: [{ shared: false }],
      },
    });
  });

  it('blocks a request nobody is assigned to answer', () => {
    const orphaned = toggleAssignment(quickDraft(), PICK_ONE.id, KARL.userId);
    expect(feedbackComposeSubmitPlan(orphaned)).toEqual({
      kind: 'blocked',
      reason: 'unassignedAsk',
    });
  });

  it('is ready when nothing needs publishing', () => {
    const draft = { ...quickDraft(), subjects: [subject('direction-c', true)] };
    expect(feedbackComposeSubmitPlan(draft)).toEqual({ kind: 'ready', publishSubjectRefs: [] });
  });

  it('requires explicit confirmation before an unshared subject can be sent', () => {
    const draft: FeedbackComposeDraft = {
      ...quickDraft(),
      subjects: [subject('direction-a', false), subject('direction-c', true)],
    };

    const plan = feedbackComposeSubmitPlan(draft);
    expect(plan.kind).toBe('needsPublishConfirmation');

    const confirmed = confirmPublish(draft);
    const confirmedPlan = feedbackComposeSubmitPlan(confirmed);
    expect(confirmedPlan).toEqual({
      kind: 'ready',
      publishSubjectRefs: [draft.subjects[0].ref],
    });
    expect(feedbackComposeSendPayload(confirmed, [draft.subjects[0].ref]).publishSubjectRefs).toEqual(
      [draft.subjects[0].ref],
    );
  });

  it('re-blocks when a subject the author never saw joins the publish set', () => {
    const draft: FeedbackComposeDraft = {
      ...quickDraft(),
      subjects: [subject('direction-a', false)],
    };
    const confirmed = confirmPublish(draft);
    expect(feedbackComposeSubmitPlan(confirmed).kind).toBe('ready');

    // A stale confirmation must not carry a subject that was not in the list
    // the author agreed to.
    const withAnother: FeedbackComposeDraft = {
      ...confirmed,
      subjects: [...confirmed.subjects, subject('direction-b', false)],
    };
    expect(feedbackComposeSubmitPlan(withAnother).kind).toBe('needsPublishConfirmation');
  });
});

describe('feedback compose — publish destination', () => {
  it('applies only to unshared file subjects', () => {
    const tracker: FeedbackComposeSubject = {
      ref: { orgId: 'org-1', kind: 'tracker', sourceId: 'item-9' },
      label: 'NIM-9',
      shared: false,
    };
    const draft: FeedbackComposeDraft = {
      ...quickDraft(),
      subjects: [subject('direction-a', false), subject('direction-b', true), tracker],
    };
    // A tracker has no folder, and an already-shared file is not being placed.
    expect(destinationSubjects(draft).map((s) => s.ref.sourceId)).toEqual(['direction-a']);
  });

  it('reads as the named default until the author picks one', () => {
    expect(describeDestination(undefined)).toBe(FEEDBACK_DEFAULT_DESTINATION_NAME);
    // Absent and root are different states; root is an explicit choice.
    expect(describeDestination({ folderId: null, path: '' })).toBe('Team files');
    expect(describeDestination({ folderId: 'f-1', path: 'Design/Mockups' })).toBe('Design / Mockups');
  });

  it('names a folder that does not exist yet by what the author typed', () => {
    expect(
      describeDestination({
        folderId: null,
        path: 'Design',
        pendingFolder: { name: 'Round 2', parentFolderId: 'f-design' },
      }),
    ).toBe('Design / Round 2');
  });

  it('sends the destination only when something is actually being published', () => {
    const placed = setDestination(
      { ...quickDraft(), subjects: [subject('direction-a', false)] },
      { folderId: 'f-1', path: 'Design/Mockups' },
    );
    const confirmed = confirmPublish(placed);
    const refs = [placed.subjects[0].ref];
    expect(feedbackComposeSendPayload(confirmed, refs).destination).toEqual({
      folderId: 'f-1',
      path: 'Design/Mockups',
    });

    // Nothing to publish: handing the host a destination would have it resolve,
    // and possibly create, a folder for zero documents.
    const allShared = setDestination(
      { ...quickDraft(), subjects: [subject('direction-a', true)] },
      { folderId: 'f-1', path: 'Design/Mockups' },
    );
    expect(feedbackComposeSendPayload(allShared, []).destination).toBeUndefined();
  });
});
