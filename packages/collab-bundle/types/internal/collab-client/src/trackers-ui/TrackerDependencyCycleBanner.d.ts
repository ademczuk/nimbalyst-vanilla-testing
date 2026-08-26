/**
 * TrackerDependencyCycleBanner
 *
 * A dependency cycle is a silent deadlock: every item in it is waiting on
 * another item in it, so none of them will ever appear in the ready queue and
 * nothing on screen says why. The banner is the "why" -- it names the count and
 * lists the members so the user can open one and remove a link.
 *
 * Dismissal is keyed on the membership of the cycles, not on a flag, so closing
 * it silences *this* deadlock while a newly-formed one still surfaces.
 */
import React from 'react';
import type { TrackerRecord } from '../../../runtime/src/core/TrackerRecord';
interface TrackerDependencyCycleBannerProps {
    /** Every open item the readiness model flagged as part of a cycle. */
    items: TrackerRecord[];
    onOpenItem: (itemId: string) => void;
}
export declare const TrackerDependencyCycleBanner: React.FC<TrackerDependencyCycleBannerProps>;
export {};
