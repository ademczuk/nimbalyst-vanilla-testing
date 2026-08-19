-- Local-only tracker numbers (`NIM.12`). Private to this machine: the column is
-- never included in the sync payload, so a teammate's copy of the same item has
-- no value here. It is deliberately separate from `issue_key`, which the room
-- owns -- `reconcileIssueKeyOnPublish` throws when an item already carries a key
-- and the room mints a different one, so sharing the column would fail every
-- publish.
--
-- The unique index is the backstop that the two previous attempts lacked: the
-- database itself refuses to hand the same number to two items in one project.

ALTER TABLE tracker_items ADD COLUMN local_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tracker_workspace_local_key
  ON tracker_items(workspace, local_key) WHERE local_key IS NOT NULL;
