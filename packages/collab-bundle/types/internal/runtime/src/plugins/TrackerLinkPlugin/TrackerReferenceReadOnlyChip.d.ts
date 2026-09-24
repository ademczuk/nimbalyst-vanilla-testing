/**
 * TrackerReferenceReadOnlyChip — the chip for hosts with no tracker store.
 *
 * {@link TrackerReferenceChip} resolves an item's live title/status through the
 * runtime tracker atoms and opens a click-through preview card. In a host with
 * no tracker store — the web console — every lookup returns null, so it does
 * degrade to a muted key-only chip as documented, but it stays clickable: the
 * card it opens says only that the item could not be resolved and offers no
 * action. A dead-end affordance on every reference is worse than none.
 *
 * This renders the same resting shape (the reader still sees a reference, not
 * bare prose) with no store, no popover and no navigation. Swap it for the live
 * chip in any host that gains a tracker store.
 *
 * Not a size decision: measured against the collab bundle, using the live chip
 * here instead moves the eager editor artifact by 4 gzip bytes, because the
 * runtime barrel already carries it.
 */
import type { JSX } from 'react';
import type { TrackerReferenceNodeRendererProps } from './TrackerReferenceNodeRenderer';
export declare function TrackerReferenceReadOnlyChip({ referenceKey, }: TrackerReferenceNodeRendererProps): JSX.Element;
