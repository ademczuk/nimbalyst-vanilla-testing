-- Workspace-scoped local projection of first-class Feedback Request resources.
-- The Durable Object remains authoritative; this cache keeps respond/results
-- surfaces usable during reconnects and across app restarts.

CREATE TABLE IF NOT EXISTS feedback_request_cache (
  workspace_path TEXT NOT NULL,
  org_id         TEXT NOT NULL,
  viewer_user_id TEXT NOT NULL,
  request_id     TEXT NOT NULL,
  data           TEXT NOT NULL, -- JSON: { request, progress }
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (workspace_path, org_id, viewer_user_id, request_id)
);

CREATE INDEX IF NOT EXISTS idx_feedback_request_cache_org
  ON feedback_request_cache (workspace_path, org_id, viewer_user_id, updated_at);
