/** Pure reconciliation reducer for a cached GitHub issue and one local tracker item. */

export type GithubIssueStateSnapshot = "open" | "closed";

export interface GithubIssueUpstreamSnapshot {
  state: GithubIssueStateSnapshot;
  title: string;
  labels: ReadonlyArray<{ name: string }>;
}

/**
 * The renderer normalizes a tracker record into this deliberately small shape.
 * `state` is `closed` when the record's workflow status is terminal, otherwise
 * `open`. Snapshot fields come from `record.system.origin.external`; legacy
 * native records without external provenance leave them undefined.
 */
export interface GithubIssueLocalSnapshot {
  state: GithubIssueStateSnapshot;
  titleSnapshot?: string | null;
  labels: readonly string[];
  upstreamBodyChanged?: boolean;
}

export type GithubIssueDivergenceAxis = "state" | "title" | "body" | "labels";

export interface GithubIssueDivergenceResult {
  needsAttention: boolean;
  axes: GithubIssueDivergenceAxis[];
  state: {
    upstream: GithubIssueStateSnapshot;
    local: GithubIssueStateSnapshot;
  } | null;
  title: {
    upstream: string;
    snapshot: string;
  } | null;
  /** This flag is copied from TrackerImportService provenance; no body diff runs here. */
  upstreamBodyChanged: boolean;
  /** Upstream label spelling is preserved for display and re-snapshot feedback. */
  addedUpstreamLabels: string[];
}

function labelKey(label: string): string {
  return label.trim().toLowerCase();
}

export function detectGithubIssueDivergence(
  upstream: GithubIssueUpstreamSnapshot,
  local: GithubIssueLocalSnapshot
): GithubIssueDivergenceResult {
  const state =
    upstream.state === local.state
      ? null
      : { upstream: upstream.state, local: local.state };
  const title =
    local.titleSnapshot != null && upstream.title !== local.titleSnapshot
      ? { upstream: upstream.title, snapshot: local.titleSnapshot }
      : null;
  const upstreamBodyChanged = local.upstreamBodyChanged === true;
  const localLabels = new Set(local.labels.map(labelKey));
  const seenUpstreamLabels = new Set<string>();
  const addedUpstreamLabels = upstream.labels.flatMap(({ name }) => {
    const key = labelKey(name);
    if (!key || localLabels.has(key) || seenUpstreamLabels.has(key)) return [];
    seenUpstreamLabels.add(key);
    return [name];
  });

  const axes: GithubIssueDivergenceAxis[] = [];
  if (state) axes.push("state");
  if (title) axes.push("title");
  if (upstreamBodyChanged) axes.push("body");
  if (addedUpstreamLabels.length > 0) axes.push("labels");

  return {
    needsAttention: axes.length > 0,
    axes,
    state,
    title,
    upstreamBodyChanged,
    addedUpstreamLabels,
  };
}
