/**
 * Live tracker reference views for hosts that resolve references through a
 * {@link TrackerReferenceResolver} rather than the desktop tracker atoms.
 *
 * Three presentations of one `TrackerReferenceNode`:
 *  - chip: inline key + title + status, the resting shape of every reference;
 *    or, where the host opts into the quiet inline appearance, the title as a
 *    tinted link with the rest in a hover peek.
 *  - card: a block summary of the item with the few fields its type is about.
 *  - statements: the claims whose subject is the item, grouped by predicate.
 *
 * With no resolver in context every view renders the store-free read-only chip,
 * so registering this renderer is safe in a host that never provides one.
 */
import type { JSX } from 'react';
import type { TrackerReferenceNodeRendererProps } from '../../../../runtime/src/plugins/TrackerLinkPlugin/TrackerReferenceNodeRenderer';
import './trackerReferenceViews.css';
/** Mirrors the runtime node's `TrackerReferenceView`; optional so a pre-view node renders as a chip. */
export type TrackerReferenceViewKind = 'chip' | 'card' | 'statements';
export type LiveTrackerReferenceRendererProps = TrackerReferenceNodeRendererProps & {
    view?: TrackerReferenceViewKind;
};
/** Live inline chip for an item id or key, for use inside cards and host surfaces. */
export declare function TrackerReferenceChipView({ referenceKey }: {
    referenceKey: string;
}): JSX.Element;
/**
 * `TrackerReferenceNode` renderer for hosts with a resolver in context. Falls
 * back to the read-only chip, in every view, when none is provided.
 */
export declare function LiveTrackerReferenceRenderer(props: LiveTrackerReferenceRendererProps): JSX.Element;
