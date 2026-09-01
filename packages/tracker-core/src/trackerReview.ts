export const REVIEW_IN_REVIEW = "in-review";
export const REVIEW_APPROVED = "approved";
export const REVIEW_CHANGES_REQUESTED = "changes-requested";

export const REVIEW_LANE_STATUSES = [
  REVIEW_IN_REVIEW,
  REVIEW_CHANGES_REQUESTED,
  REVIEW_APPROVED,
] as const;

const HUMAN_ONLY_STATUSES = new Set<string>([REVIEW_APPROVED]);

export function isReviewLaneStatus(status: string): boolean {
  return (REVIEW_LANE_STATUSES as readonly string[]).includes(status);
}

export function isHumanOnlyStatus(status: unknown): boolean {
  return (
    typeof status === "string" &&
    HUMAN_ONLY_STATUSES.has(status.trim().toLowerCase())
  );
}

export function humanOnlyStatusMessage(status: string): string {
  return (
    `'${status}' can only be set by a person. Move the item to '${REVIEW_IN_REVIEW}' ` +
    "and let a reviewer promote it."
  );
}
