/**
 * Studying one option properly without leaving the comparison.
 *
 * The level that was missing. Before this, deciding between designs had two
 * stops and neither decided anything: a 128px card, which tells options apart
 * but cannot show a layout, and a full tab, which shows one design properly and
 * costs you the others. Opening a tab is what loses the comparison -- by the
 * time you are back, you are comparing against memory.
 *
 * So the popover is near-viewport, it is anchored to the card it grew from, and
 * two things live inside it that would otherwise be somewhere else:
 *
 * - **The vote is in the footer.** Same rule as the comparison itself: if
 *   deciding means dismissing first, the surface has split the decision from
 *   the thing it is about all over again.
 * - **Stepping carries your place.** Scroll to the pricing table in A, step to
 *   B, land on B's pricing table. As a fraction, never as pixels -- see
 *   `artifactScrollCarry`.
 *
 * ## The content is live, and that has a cost worth naming
 *
 * Clicks reach the mockup: hover states, disclosure toggles, tab strips inside
 * the design. That is most of what makes a design feel like a thing rather than
 * a picture of one.
 *
 * The cost is that a dead-end control now reads as a bug. Nothing was clickable
 * before and nobody expected anything; now an unbuilt button inside someone's
 * mockup looks broken and gets filed as one. The chrome answers that: it is
 * persistent, quiet, and says what this is -- a mockup, by name -- rather than
 * presenting an unlabelled interactive surface.
 *
 * Interactive is not editable, and the boundary is structural rather than
 * enforced: `MockupEditor` holds the HTML *source* in a `Y.Text` and renders it
 * into the iframe, so DOM mutation inside the frame has no path back to the
 * shared document. That safety is a property of how the editor is built today
 * and nobody wrote it down, so it is covered by a test rather than trusted.
 */
import React from 'react';
import type { FeedbackAskArtifact } from '@nimbalyst/collab-protocol';
/**
 * Structurally identical to the extension SDK's `EditorViewport`, and declared
 * here rather than imported for the reason `structuredInput.ts` gives for
 * staying free of collaboration types: this package bundles for the browser,
 * and taking a dependency on the extension SDK to name a two-method interface
 * would pull the whole editor contract into a bundle that has no editors in it.
 *
 * The host passes the SDK's own type and it satisfies this one, so the two stay
 * compatible without either package importing the other.
 */
export interface FeedbackArtifactScrollViewport {
    /** Current position in `[0, 1]`. Content with nowhere to scroll returns 0. */
    getScrollFraction(): number;
    /** Restore a position captured from a document of any length. */
    setScrollFraction(fraction: number): void;
}
/**
 * One thing the popover can show. Built by the ask field rather than derived
 * here, so the popover never has to know what an ask type is.
 */
export interface FeedbackArtifactDetailEntry {
    /** A `singleSelect` option id or a `reorder` item id. */
    entryId: string;
    artifact: FeedbackAskArtifact;
    /** The entry's own label. This is what the vote is for, not the artifact's. */
    label: string;
}
/**
 * What the host is handed when the popover asks it to paint an artifact.
 *
 * `onViewportReady` is how the scroll carry crosses the layering boundary. The
 * popover cannot read a scroll position that lives inside an extension's
 * iframe, and has no business trying; the editor publishes one through
 * `EditorHost.registerViewport` and the host forwards it here. A host that does
 * not, or an editor that never registers, simply does not carry scroll -- each
 * artifact then opens at the top, which is a worse experience and not a bug.
 */
export interface FeedbackArtifactDetailMountApi {
    onViewportReady(viewport: FeedbackArtifactScrollViewport | null): void;
}
/**
 * Paints one artifact at full size. Returning nullish is a supported answer,
 * exactly as for the card preview renderer: "I can paint artifacts, and this
 * particular one has nothing to show."
 */
export type FeedbackArtifactDetailRenderer = (entry: FeedbackArtifactDetailEntry, api: FeedbackArtifactDetailMountApi) => React.ReactNode;
export interface FeedbackArtifactDetailPopoverProps {
    entries: readonly FeedbackArtifactDetailEntry[];
    activeEntryId: string;
    onActiveEntryChange(entryId: string): void;
    onDismiss(): void;
    /** The card or column this grew from. Anchoring keeps the origin legible. */
    anchor: HTMLElement | null;
    /** Nullish means the host cannot paint this artifact; the chrome says so. */
    renderArtifact: FeedbackArtifactDetailRenderer;
    /** Absent means this ask is not a vote (a reorder), so no footer control. */
    onSelect?(entryId: string): void;
    selectedId?: string;
    disabled?: boolean;
    /** Escalation. The tab is one step further in, for commenting and editing. */
    onOpenInTab?(artifact: FeedbackAskArtifact): void;
}
export declare const FeedbackArtifactDetailPopover: React.FC<FeedbackArtifactDetailPopoverProps>;
