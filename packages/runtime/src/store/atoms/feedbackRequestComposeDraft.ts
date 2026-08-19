/**
 * Feedback-request compose draft atoms.
 *
 * Per-tool-call draft state for the compose surface, in a jotai atomFamily
 * keyed by toolCall.providerToolCallId so the author's edits (recipients, ask
 * assignment, delivery settings, publish confirmation) survive widget unmount
 * -- session switches and the transcript's virtual scroller unmounting
 * off-screen rows. Same pattern as askUserQuestionDraft/requestUserInputDraft.
 *
 * The widget owns this state; nothing is lifted into a parent.
 */

import { atom } from 'jotai';
import { atomFamily } from 'jotai-family';
import type { FeedbackComposeDraft } from '../../ui/AgentTranscript/components/CustomToolWidgets/feedback/feedbackComposeDraft';

/** null until the widget seeds it from the tool call's arguments. */
export const feedbackRequestComposeDraftAtom = atomFamily((_toolCallId: string) =>
  atom<FeedbackComposeDraft | null>(null),
);

/** Drop the atom for a sent or cancelled request so resolved drafts don't leak. */
export function clearFeedbackRequestComposeDraft(toolCallId: string): void {
  feedbackRequestComposeDraftAtom.remove(toolCallId);
}
