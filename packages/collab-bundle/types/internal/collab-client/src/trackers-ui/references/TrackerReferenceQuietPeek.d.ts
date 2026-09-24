/**
 * The hover peek of a quiet tracker reference. Loaded lazily on the first
 * hover or focus so `@floating-ui/react` stays out of the trackers-ui eager
 * graph; the link itself (TrackerReferenceQuietLink) owns open state and timing.
 */
import type { JSX } from 'react';
import type { TrackerItem } from '../../trackers/dataSource';
import type { TrackerReferenceStatusInfo, TrackerReferenceTypeInfo } from './trackerReferenceResolver';
export interface TrackerReferenceQuietPeekProps {
    anchor: HTMLElement;
    item: TrackerItem;
    referenceKey: string;
    typeInfo: TrackerReferenceTypeInfo;
    status: TrackerReferenceStatusInfo | null;
    summary: string | null;
    onPointerEnter: () => void;
    onPointerLeave: () => void;
}
export declare function TrackerReferenceQuietPeek({ anchor, item, referenceKey, typeInfo, status, summary, onPointerEnter, onPointerLeave, }: TrackerReferenceQuietPeekProps): JSX.Element;
