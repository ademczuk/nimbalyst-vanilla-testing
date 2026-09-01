export declare const REVIEW_IN_REVIEW = "in-review";
export declare const REVIEW_APPROVED = "approved";
export declare const REVIEW_CHANGES_REQUESTED = "changes-requested";
export declare const REVIEW_LANE_STATUSES: readonly ["in-review", "changes-requested", "approved"];
export declare function isReviewLaneStatus(status: string): boolean;
export declare function isHumanOnlyStatus(status: unknown): boolean;
export declare function humanOnlyStatusMessage(status: string): string;
