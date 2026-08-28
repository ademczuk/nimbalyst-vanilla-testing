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
export type FeedbackSubjectOpener = (subject: FeedbackArtifact) => void;
export type FeedbackArtifactAction = {
    open?: () => void;
    /** Visible only when the host recognized the kind but could not resolve it. */
    unavailableReason?: string;
};
export type FeedbackArtifactActionResolver = (artifact: FeedbackArtifact) => FeedbackArtifactAction;
/**
 * Nullish means "I have a renderer and this subject has nothing worth showing",
 * exactly as it does for an option card. The subject then renders as the row it
 * has always been.
 */
export type FeedbackSubjectPreviewRenderer = (subject: FeedbackArtifact, index: number) => React.ReactNode;
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
export declare const FeedbackArtifactSubjects: React.FC<FeedbackArtifactSubjectsProps>;
