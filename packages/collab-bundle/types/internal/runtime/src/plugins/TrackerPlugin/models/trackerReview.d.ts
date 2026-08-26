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
export declare const REVIEW_IN_REVIEW = "in-review";
export declare const REVIEW_APPROVED = "approved";
export declare const REVIEW_CHANGES_REQUESTED = "changes-requested";
/** The lane, in the order a reviewer walks it. */
export declare const REVIEW_LANE_STATUSES: readonly ["in-review", "changes-requested", "approved"];
export declare function isReviewLaneStatus(status: string): boolean;
/** Whether a status is one an agent must not set on a user's behalf. */
export declare function isHumanOnlyStatus(status: string | undefined | null): boolean;
/**
 * The message an agent gets when it tries to promote its own work. Phrased as
 * the next action rather than a bare refusal, so the agent moves the item to
 * `in-review` instead of retrying.
 */
export declare function humanOnlyStatusMessage(status: string): string;
/** Which review-lane statuses a type actually offers, in lane order. */
export declare function reviewLaneFor(type: string): string[];
/** Whether a type has a review lane at all. */
export declare function hasReviewLane(type: string): boolean;
