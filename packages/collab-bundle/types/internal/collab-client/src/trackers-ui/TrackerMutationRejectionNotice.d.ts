import React from 'react';
import type { TrackerMutationRejection } from '../trackers/index';
export declare function formatTrackerMutationRejection(rejection: TrackerMutationRejection): string;
export interface TrackerMutationRejectionNoticeProps {
    rejection: TrackerMutationRejection | null;
}
/** The visible counterpart to the engine's optimistic rollback. */
export declare function TrackerMutationRejectionNotice({ rejection }: TrackerMutationRejectionNoticeProps): React.JSX.Element | null;
