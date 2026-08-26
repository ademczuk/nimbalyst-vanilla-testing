-- History retention needs to find, and order, the snapshots for one file.
--
-- The existing file_path-leading indexes are both partial (pending-review rows,
-- and rows carrying a baseMarkdownHash), so neither serves a general lookup,
-- and idx_history_workspace_file leads with workspace_id. Without this index a
-- per-file retention pass has to scan the whole table -- which stores full file
-- content -- once per file.
--
-- Ordering by timestamp DESC in the index matches the retention query's
-- ORDER BY, so keeping the newest N per file is an index range read rather than
-- a sort over every blob.

CREATE INDEX IF NOT EXISTS idx_history_file_timestamp
  ON document_history(file_path, timestamp DESC);
