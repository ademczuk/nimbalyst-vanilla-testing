/**
 * What the request is *about*, wherever the request is read.
 *
 * The compose surface has shown the author their subject list since it shipped;
 * the recipient was shown nothing. That asymmetry is the whole reason this file
 * exists: a request that publishes two mockups to the team and then hands the
 * person being asked no way to reach either one is a question you cannot answer.
 * The author's own results view has the same need once the answers are in, so
 * this list is shared by both and is named for the subjects, not the surface.
 *
 * Two things here are deliberate:
 *
 * - **The label comes from the request, never from the ref.** By the time a
 *   subject reaches a recipient, publishing has rewritten a `file` ref to the
 *   created `document`, so `sourceId` is an opaque id. `FeedbackArtifact` exists
 *   to carry the author's words alongside it, on the same reasoning as
 *   `BoundedPreview`.
 * - **No host means readable, not hidden.** Without `onOpen` the rows render as
 *   plain text rather than disappearing. A recipient who cannot open a subject
 *   should still know what they are being asked about, and the surrounding card
 *   already takes this stance for submitting.
 */

import React from 'react';
import type { FeedbackArtifact, ResourceRef } from '@nimbalyst/collab-protocol';
import { normalizeFeedbackArtifact } from '@nimbalyst/collab-protocol';

export type FeedbackSubjectOpener = (subject: FeedbackArtifact) => void;

export type FeedbackArtifactAction = {
  open?: () => void;
  /** Visible only when the host recognized the kind but could not resolve it. */
  unavailableReason?: string;
};

export type FeedbackArtifactActionResolver = (
  artifact: FeedbackArtifact,
) => FeedbackArtifactAction;

/**
 * Nullish means "I have a renderer and this subject has nothing worth showing",
 * exactly as it does for an option card. The subject then renders as the row it
 * has always been.
 */
export type FeedbackSubjectPreviewRenderer = (
  subject: FeedbackArtifact,
  index: number,
) => React.ReactNode;

export interface FeedbackArtifactSubjectsProps {
  /**
   * Optional at runtime even though the protocol type is not: a request synced
   * from a server older than subjects arrives without the key, and the
   * surrounding card already reads `discussion` the same defensive way. A
   * missing list is "nothing to show", never a crashed Inbox.
   */
  subjects?: readonly (FeedbackArtifact | ResourceRef)[];
  onOpen?: FeedbackSubjectOpener;
  resolveAction?: FeedbackArtifactActionResolver;
  /**
   * Paints what the request is about, rather than naming it.
   *
   * Strictly additive: absent, or returning nullish, and every subject is the
   * text row this component has always rendered. That is what keeps the two
   * degradation contracts above intact -- "no host means readable, not hidden",
   * and an `unavailableReason` still explaining itself -- without either being
   * re-implemented for the preview path.
   */
  renderPreview?: FeedbackSubjectPreviewRenderer;
  /**
   * The whole preview panel is the click target when this is supplied. Falls
   * back to the row's own `open` when it is not, so a host that can paint but
   * cannot expand still opens the subject somewhere.
   */
  onExpand?: (subject: FeedbackArtifact, anchor: HTMLElement | null) => void;
}

const KIND_LABELS: Record<ResourceRef['kind'], string> = {
  document: 'Document',
  tracker: 'Tracker item',
  file: 'File',
  session: 'Session',
  commit: 'Commit',
  pullRequest: 'Pull request',
  conversation: 'Conversation',
  feedbackRequest: 'Feedback request',
};

const SubjectBody: React.FC<{
  subject: FeedbackArtifact;
  unavailableReason?: string;
}> = ({ subject, unavailableReason }) => (
  <span className="feedback-artifact-subject-body flex min-w-0 flex-col gap-0.5 text-left">
    <span className="truncate text-xs font-semibold leading-snug text-nim">
      {subject.label}
    </span>
    <span className="truncate text-[0.6875rem] leading-snug text-nim-muted">
      {subject.context
        ? `${KIND_LABELS[subject.ref.kind]} · ${subject.context}`
        : KIND_LABELS[subject.ref.kind]}
    </span>
    {unavailableReason && (
      <span className="feedback-artifact-unavailable-reason text-[0.6875rem] leading-snug text-nim-faint">
        {unavailableReason}
      </span>
    )}
  </span>
);

export const FeedbackArtifactSubjects: React.FC<FeedbackArtifactSubjectsProps> = ({
  subjects,
  onOpen,
  resolveAction,
  renderPreview,
  onExpand,
}) => {
  if (!subjects?.length) return null;

  const previews = renderPreview
    ? subjects.map((raw, index) => renderPreview(normalizeFeedbackArtifact(raw), index))
    : [];
  const anyPreview = previews.some((preview) => preview != null);

  return (
    <div
      data-testid="feedback-artifact-subjects"
      data-has-previews={anyPreview || undefined}
      className={anyPreview
        ? 'feedback-artifact-subjects grid gap-2.5'
        : 'feedback-artifact-subjects flex flex-col gap-1.5'}
      /*
       * Sized to the subjects, exactly as the option grid is sized to the
       * options -- but with a larger floor, because a subject is what the whole
       * request is about rather than one of several answers to it. One subject
       * then spans the row, which against `PREVIEW_AUTHORED_WIDTH` is a
       * readable layout instead of the smudge a 260px column produced.
       */
      style={anyPreview
        ? { gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))' }
        : undefined}
    >
      {subjects.map((raw, index) => {
        const subject = normalizeFeedbackArtifact(raw);
        const key = `${subject.ref.kind}\u0000${subject.ref.sourceId}\u0000${index}`;
        const action = resolveAction?.(subject)
          ?? (onOpen ? { open: () => onOpen(subject) } : {});
        const preview = previews[index];

        if (preview != null) {
          /*
           * Preview panel on top, the row beneath: the same object an option
           * card is, minus the radio. The row is this component's own existing
           * markup rather than a second rendering of the same facts, which is
           * what keeps `unavailableReason` and the no-host case correct here
           * without either being written twice.
           */
          const canExpand = Boolean(onExpand) || Boolean(action.open);
          return (
            <div
              key={key}
              data-testid="feedback-artifact-subject"
              data-subject-kind={subject.ref.kind}
              className="feedback-artifact-subject feedback-artifact-subject-card overflow-hidden rounded border border-nim bg-nim-secondary"
            >
              {canExpand ? (
                <button
                  type="button"
                  data-testid="feedback-artifact-subject-expand"
                  aria-label={`Open ${subject.label}`}
                  onClick={(event) => {
                    const anchor = event.currentTarget
                      .closest<HTMLElement>('.feedback-artifact-subject');
                    if (onExpand) onExpand(subject, anchor);
                    else action.open?.();
                  }}
                  className="feedback-artifact-subject-preview relative block h-64 w-full border-b border-nim bg-nim p-2.5 text-left cursor-zoom-in hover:ring-1 hover:ring-inset hover:ring-nim-primary"
                >
                  {preview}
                </button>
              ) : (
                <div className="feedback-artifact-subject-preview relative h-64 border-b border-nim bg-nim p-2.5">
                  {preview}
                </div>
              )}
              <div className="flex items-center gap-2 px-2.5 py-2 select-text">
                <SubjectBody subject={subject} unavailableReason={action.unavailableReason} />
              </div>
            </div>
          );
        }

        const shared = 'flex w-full items-center gap-2 rounded border border-nim bg-nim-secondary px-2.5 py-2';
        return action.open ? (
          <button
            key={key}
            type="button"
            data-testid="feedback-artifact-subject"
            data-subject-kind={subject.ref.kind}
            onClick={action.open}
            className={`feedback-artifact-subject ${shared} cursor-pointer text-left hover:bg-nim-hover`}
          >
            <SubjectBody subject={subject} />
            <span className="ml-auto shrink-0 text-[0.6875rem] text-nim-faint">Open</span>
          </button>
        ) : (
          <div
            key={key}
            data-testid="feedback-artifact-subject"
            data-subject-kind={subject.ref.kind}
            className={`feedback-artifact-subject ${shared} select-text`}
          >
            <SubjectBody
              subject={subject}
              unavailableReason={action.unavailableReason}
            />
          </div>
        );
      })}
    </div>
  );
};
