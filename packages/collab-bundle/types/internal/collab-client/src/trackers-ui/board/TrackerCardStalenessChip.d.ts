/**
 * The staleness chip on a board card.
 *
 * It flags one disagreement -- a plan still marked draft or ready-for-development
 * whose linked session has committed -- and it never writes. The popover shows the
 * commits and sessions the signal was built from, because the heuristic is
 * genuinely fallible: the audit that motivated this feature listed four plans as
 * shipped and two of the four did not hold up once the commits were read. So the
 * chip asks a question and hands over the evidence rather than announcing a
 * verdict the reader cannot check.
 */
import React from 'react';
import type { TrackerRecord } from '../../../../runtime/src/core/TrackerRecord';
import './TrackerBoardCard.css';
interface TrackerCardStalenessChipProps {
    item: TrackerRecord;
}
export declare const TrackerCardStalenessChip: React.FC<TrackerCardStalenessChipProps>;
export {};
