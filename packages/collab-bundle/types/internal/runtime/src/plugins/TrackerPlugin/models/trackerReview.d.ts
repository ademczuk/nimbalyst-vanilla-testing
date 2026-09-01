/**
 * The review lane on the workflow-status role.
 *
 * Work moves `in-progress` -> `in-review` -> `approved` (or back out through
 * `changes-requested`). The lane exists so a colleague reviewing your
 * implementation has a state to leave the item in that is neither "still being
 * worked" nor "done".
 *
 * The house rule this module enforces: **an agent may move an item into review,
 * but only a human may promote it past.** An agent marking its own work
 * approved would make the review lane meaningless, so `approved` is refused at
 * the agent tool boundary rather than merely discouraged in a prompt.
 */
export { REVIEW_APPROVED, REVIEW_CHANGES_REQUESTED, REVIEW_IN_REVIEW, REVIEW_LANE_STATUSES, humanOnlyStatusMessage, isHumanOnlyStatus, isReviewLaneStatus, } from '@nimbalyst/tracker-core';
/** Which review-lane statuses a type actually offers, in lane order. */
export declare function reviewLaneFor(type: string): string[];
/** Whether a type has a review lane at all. */
export declare function hasReviewLane(type: string): boolean;
