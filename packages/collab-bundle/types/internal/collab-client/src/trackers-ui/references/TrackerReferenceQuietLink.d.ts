/**
 * The quiet inline appearance of a tracker reference: the item's full title as
 * link text, with a kind-tinted underline (dashed for questions) as the only
 * chrome. Key, kind, state and a one-line summary move to a hover peek.
 *
 * A reader never needs the key in prose, and a sentence listing a dozen pages
 * as bordered pills is unreadable, so hosts whose documents are prose opt into
 * this. It changes presentation only; the node and its markdown are untouched.
 */
import type { JSX } from 'react';
import type { TrackerItem } from '../../trackers/dataSource';
import { type ResolverProps } from './TrackerReferenceParts';
import type { TrackerReferenceResolver } from './trackerReferenceResolver';
/** How an inline (`chip` view) reference renders in prose. */
export type TrackerReferenceInlineAppearance = 'chip' | 'quiet';
export declare const TrackerReferenceInlineAppearanceContext: import("react").Context<TrackerReferenceInlineAppearance>;
export declare function useTrackerReferenceInlineAppearance(): TrackerReferenceInlineAppearance;
/** What the item is about, in the field its kind keeps it in. */
export declare function peekSummary(resolver: TrackerReferenceResolver, item: TrackerItem): string | null;
export declare function QuietLink({ resolver, referenceKey }: ResolverProps): JSX.Element;
