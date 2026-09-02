-- ----------------------------------------------------------------------------
-- 0040_worktree_source_folder
--
-- Which root of a multi-root workspace a worktree was branched from.
--
-- `workspace_id` is the workspace's PRIMARY root and stays the identity anchor
-- (sessions, kanban, trackers all key off it). Once a workspace can span
-- several folders, that no longer says which repository the worktree came out
-- of, so record it separately.
--
-- Nullable, and backfilled to `workspace_id`: every worktree created before
-- multi-root existed came from the primary root by definition.
-- ----------------------------------------------------------------------------

ALTER TABLE worktrees ADD COLUMN source_folder_path TEXT;

UPDATE worktrees SET source_folder_path = workspace_id WHERE source_folder_path IS NULL;
