/**
 * The interactive control for one ask.
 *
 * Every type except `singleSelect` renders through the shared widget chrome or
 * the shipped `reorder` list, so an ask answered here behaves the same as the
 * equivalent field in a local prompt. `singleSelect` is the deliberate
 * exception -- see `FeedbackRespondOptionCards`.
 */
import React from 'react';
import { type FeedbackAnswer, type FeedbackAsk, type FeedbackAskArtifact } from '@nimbalyst/collab-protocol';
import { type FeedbackOptionPreviewRenderer } from './FeedbackRespondOptionCards';
import type { FeedbackArtifactDetailRenderer } from './FeedbackArtifactDetailPopover';
import type { FeedbackArtifactActionResolver } from './FeedbackArtifactSubjects';
export interface FeedbackRespondAskFieldProps {
    ask: FeedbackAsk;
    answer?: FeedbackAnswer;
    onChange: (answer: FeedbackAnswer) => void;
    disabled?: boolean;
    renderOptionPreview?: FeedbackOptionPreviewRenderer;
    /** Opens a bound artifact; absent means no expand affordance is offered. */
    onExpandArtifact?: (artifact: FeedbackAskArtifact) => void;
    /**
     * Paints one artifact full-size for the detail popover.
     *
     * Supplied means expand opens the popover; absent means expand still opens a
     * tab, which is what every host did before the popover existed. That
     * fallback is why a host can adopt this one at a time rather than all at
     * once, and why the browser keeps a working expand button until it has an
     * inline document component of its own.
     */
    renderArtifactDetail?: FeedbackArtifactDetailRenderer;
    resolveArtifactAction?: FeedbackArtifactActionResolver;
}
export declare const FeedbackRespondAskField: React.FC<FeedbackRespondAskFieldProps>;
