-- Pure, re-fetchable cache for the workspace-scoped GitHub issues surface.
-- JSON is TEXT on SQLite and JSONB on PGLite; stores parse the whole `data`
-- column defensively. Every timestamp uses TIMESTAMPTZ per DATABASE.md.

CREATE TABLE IF NOT EXISTS github_issues (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  remote       TEXT NOT NULL,
  number       INTEGER NOT NULL,
  state        TEXT NOT NULL,
  data         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL,
  fetched_at   TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (workspace_id, remote, number)
);

CREATE INDEX IF NOT EXISTS idx_github_issues_workspace_remote_state
  ON github_issues (workspace_id, remote, state);
CREATE INDEX IF NOT EXISTS idx_github_issues_updated
  ON github_issues (updated_at);

CREATE TABLE IF NOT EXISTS github_issue_comments (
  issue_id   TEXT NOT NULL REFERENCES github_issues(id) ON DELETE CASCADE,
  id         TEXT NOT NULL,
  data       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (issue_id, id)
);

CREATE INDEX IF NOT EXISTS idx_github_issue_comments_issue_created
  ON github_issue_comments (issue_id, created_at);

CREATE TABLE IF NOT EXISTS github_issue_events (
  issue_id   TEXT NOT NULL REFERENCES github_issues(id) ON DELETE CASCADE,
  id         TEXT NOT NULL,
  event      TEXT NOT NULL,
  data       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (issue_id, id)
);

CREATE INDEX IF NOT EXISTS idx_github_issue_events_issue_created
  ON github_issue_events (issue_id, created_at);

CREATE TABLE IF NOT EXISTS github_issue_poll_state (
  workspace_id           TEXT NOT NULL,
  remote                 TEXT NOT NULL,
  last_successful_poll_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (workspace_id, remote)
);

-- Overlay uniqueness belongs at the persistence boundary so renderer windows
-- and agent tools converge even when they race after the same read.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tracker_github_issue_overlay_url
  ON tracker_items (workspace, lower(json_extract(data, '$.issueUrl')))
  WHERE type = 'github-issue'
    AND deleted_at IS NULL
    AND json_extract(data, '$.issueUrl') IS NOT NULL;
