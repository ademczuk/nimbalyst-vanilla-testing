/**
 * Request-level subjects, adapted to what the detail popover already accepts.
 *
 * `FeedbackArtifactDetailPopover` was built for per-option artifacts, so its
 * entries are keyed by an *entry* -- a `singleSelect` option id or a `reorder`
 * item id. A request subject has no entry: it is what the whole request is
 * about, not one of the answers to it.
 *
 * Rather than widen the popover, subjects synthesise the id they lack. The
 * popover then needs no change at all, including for the vote: it already
 * treats a missing `onSelect` as "this is not a vote, so no footer control",
 * which is exactly true of a subject.
 *
 * **The id must be stable across renders.** It keys the popover's active entry
 * and, through it, the mount that paints the artifact. An id that changed every
 * render would remount the editor every render -- the same class of bug as the
 * detail mount api that was rebuilt each pass and nulled the viewport moments
 * after the editor published it. Derived from the ref and the position, both of
 * which are stable for a given request snapshot.
 */

import type { FeedbackArtifact, FeedbackAskArtifact } from '@nimbalyst/collab-protocol';
import { normalizeFeedbackArtifact } from '@nimbalyst/collab-protocol';
import type { FeedbackArtifactDetailEntry } from './FeedbackArtifactDetailPopover';

/**
 * The index is part of the id on purpose. Two subjects can legitimately name
 * the same resource -- the same mockup listed twice with different labels --
 * and collapsing them to one id would make the popover step to the wrong one.
 */
export function feedbackSubjectEntryId(
  subject: FeedbackArtifact,
  index: number,
): string {
  return `subject\x00${subject.ref.kind}\x00${subject.ref.sourceId}\x00${index}`;
}

/** The subject as the popover wants it: an artifact carrying its own entry id. */
export function feedbackSubjectAsAskArtifact(
  subject: FeedbackArtifact,
  index: number,
): FeedbackAskArtifact {
  return { ...subject, entryId: feedbackSubjectEntryId(subject, index) };
}

/**
 * Every subject as a popover entry, so stepping moves between the things the
 * request is about rather than dead-ending on the one that was clicked.
 */
export function feedbackSubjectDetailEntries(
  subjects: readonly FeedbackArtifact[],
): FeedbackArtifactDetailEntry[] {
  return subjects.map((raw, index) => {
    const subject = normalizeFeedbackArtifact(raw);
    return {
      entryId: feedbackSubjectEntryId(subject, index),
      artifact: feedbackSubjectAsAskArtifact(subject, index),
      // The subject's own name. There is no entry label to prefer over it, the
      // way an option's label outranks its artifact's.
      label: subject.label,
    };
  });
}
