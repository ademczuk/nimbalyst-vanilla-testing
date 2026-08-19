-- Ledger mapping a git commit sha to the AI session that produced it. Feeds
-- the Session column in the Git extension's Git Log panel.
--
-- Keyed on commit_sha alone (not workspace): a session running in a worktree
-- commits under the worktree path, but the user browses the log from the main
-- checkout. SHAs are content-addressed and globally unique, so workspace_id is
-- informational only and must never appear in the read path's WHERE clause.
--
-- The composite primary key allows a commit to carry more than one session
-- (contributor sets) later without a migration. attribution is 'exact' in v1;
-- the column exists so an inferred/heuristic tier can land without a migration.

CREATE TABLE IF NOT EXISTS session_commits (
  commit_sha   TEXT NOT NULL,
  session_id   TEXT NOT NULL,
  workspace_id TEXT,
  attribution  TEXT NOT NULL DEFAULT 'exact',
  committed_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (commit_sha, session_id)
);

CREATE INDEX IF NOT EXISTS idx_session_commits_session ON session_commits (session_id);

-- Resumable backfill state for the ~2M-row ai_agent_messages scan. The cutoff
-- is captured when this schema first lands so the backfill never overlaps
-- commits recorded live by the new write path. cursor_at is the created_at of
-- the oldest row scanned so far (the scan runs newest-first so the commits at
-- the top of the log resolve first); an interrupted run resumes from there.

CREATE TABLE IF NOT EXISTS session_commit_backfill_meta (
  singleton    INTEGER PRIMARY KEY CHECK (singleton = 1),
  cutoff_at    TIMESTAMPTZ NOT NULL,
  cursor_at    TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

INSERT INTO session_commit_backfill_meta (singleton, cutoff_at)
VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
ON CONFLICT (singleton) DO NOTHING;
