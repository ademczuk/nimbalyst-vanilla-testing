-- ----------------------------------------------------------------------------
-- 0047_tracker_item_revision_scope
--
-- The revision triggers for tracker_item_revisions (table in 0045).
--
-- SCOPE: the triggers record history only for the types listed in
-- `tracker_revision_types` (the knowledge kinds). Bugs, tasks, plans and every
-- other tracker record nothing on their own, so existing tracker users pay no
-- storage for a feature they do not use. A citation can still pin any item:
-- `pinItemRevision` in trackerItemRevisionStore.ts appends one snapshot at
-- the moment something cites it, and that revision is kept forever like any
-- other.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tracker_revision_types (
  type TEXT PRIMARY KEY
);
INSERT INTO tracker_revision_types (type) VALUES
  ('source'), ('capture'), ('citation'),
  ('entity'), ('claim'), ('question'), ('finding'), ('investigation')
ON CONFLICT (type) DO NOTHING;


-- Every trigger below finds the tip with `item_id = ?` plus a parent lookup
-- for the same item. Without an item-leading index each tracker write scans
-- the whole append-only log.
CREATE INDEX IF NOT EXISTS idx_tracker_item_revisions_item_parent
  ON tracker_item_revisions(item_id, parent_revision_id);

DROP TRIGGER IF EXISTS tracker_items_ai_revision;
DROP TRIGGER IF EXISTS tracker_items_au_revision;
DROP TRIGGER IF EXISTS tracker_items_ad_revision;

-- The WHEN guard makes an insert that reproduces the item's latest recorded
-- revision a no-op: same data and same deleted/live state. The PGLite->SQLite
-- cutover depends on it. It copies `tracker_item_revisions` and then
-- `tracker_items`, and without the guard every copied item, including every
-- soft-deleted one, would gain a spurious revision at cutover. An insert over
-- a tombstone tip with a live row is a resurrection and is recorded.
CREATE TRIGGER tracker_items_ai_revision AFTER INSERT ON tracker_items
WHEN new.type IN (SELECT type FROM tracker_revision_types)
AND ((
  SELECT r.data FROM tracker_item_revisions r
  WHERE r.item_id = new.id
    AND r.revision_id NOT IN (
      SELECT p.parent_revision_id FROM tracker_item_revisions p
      WHERE p.item_id = new.id AND p.parent_revision_id IS NOT NULL
    )
  LIMIT 1
) IS NOT new.data
OR (
  SELECT r.deleted_at IS NULL FROM tracker_item_revisions r
  WHERE r.item_id = new.id
    AND r.revision_id NOT IN (
      SELECT p.parent_revision_id FROM tracker_item_revisions p
      WHERE p.item_id = new.id AND p.parent_revision_id IS NOT NULL
    )
  LIMIT 1
) IS NOT (new.deleted_at IS NULL))
BEGIN
  INSERT INTO tracker_item_revisions (
    revision_id, item_id, parent_revision_id, workspace, data, actor, published, sync_status, sync_id, deleted_at
  )
  SELECT
    lower(
      substr(hex(randomblob(4)), 1, 8) || '-' ||
      substr(hex(randomblob(2)), 1, 4) || '-4' ||
      substr(hex(randomblob(2)), 2, 3) || '-' ||
      substr('89ab', abs(random()) % 4 + 1, 1) ||
      substr(hex(randomblob(2)), 2, 3) || '-' ||
      hex(randomblob(6))
    ),
    new.id,
(
  SELECT r.revision_id FROM tracker_item_revisions r
  WHERE r.item_id = new.id
    AND r.revision_id NOT IN (
      SELECT p.parent_revision_id FROM tracker_item_revisions p
      WHERE p.item_id = new.id AND p.parent_revision_id IS NOT NULL
    )
  LIMIT 1
),
    new.workspace,
    new.data,
    COALESCE(
      json_extract(new.data, '$.lastModifiedBy'),
      json_extract(new.data, '$.customFields.lastModifiedBy'),
      json_extract(new.data, '$.authorIdentity'),
      json_extract(new.data, '$.customFields.authorIdentity')
    ),
    CASE
      WHEN json_extract(new.data, '$.shared') = 1
        OR json_extract(new.data, '$.share.status') = 'team'
        OR json_extract(new.data, '$.share.body') = 'team'
        OR json_extract(new.data, '$.customFields.share.status') = 'team'
        OR json_extract(new.data, '$.customFields.share.body') = 'team' THEN 1
      WHEN json_extract(new.data, '$.shared') = 0
        OR json_extract(new.data, '$.share.status') = 'private'
        OR json_extract(new.data, '$.share.body') = 'private'
        OR json_extract(new.data, '$.customFields.share.status') = 'private'
        OR json_extract(new.data, '$.customFields.share.body') = 'private' THEN 0
      WHEN new.sync_status IN ('synced', 'pending') THEN 1
      ELSE NULL
    END,
    new.sync_status,
    new.sync_id,
    new.deleted_at;
END;

-- `OF data` plus the IS NOT guard: a sync replay that re-applies an identical
-- payload, and a write that only touches last_indexed or sync_id, must not
-- manufacture a revision. Citations would then point at churn.
CREATE TRIGGER tracker_items_au_revision AFTER UPDATE OF data, deleted_at ON tracker_items
WHEN new.type IN (SELECT type FROM tracker_revision_types)
AND (new.data IS NOT old.data OR new.deleted_at IS NOT old.deleted_at)
BEGIN
  INSERT INTO tracker_item_revisions (
    revision_id, item_id, parent_revision_id, workspace, data, actor, published, sync_status, sync_id, deleted_at
  )
  SELECT
    lower(
      substr(hex(randomblob(4)), 1, 8) || '-' ||
      substr(hex(randomblob(2)), 1, 4) || '-4' ||
      substr(hex(randomblob(2)), 2, 3) || '-' ||
      substr('89ab', abs(random()) % 4 + 1, 1) ||
      substr(hex(randomblob(2)), 2, 3) || '-' ||
      hex(randomblob(6))
    ),
    new.id,
(
  SELECT r.revision_id FROM tracker_item_revisions r
  WHERE r.item_id = new.id
    AND r.revision_id NOT IN (
      SELECT p.parent_revision_id FROM tracker_item_revisions p
      WHERE p.item_id = new.id AND p.parent_revision_id IS NOT NULL
    )
  LIMIT 1
),
    new.workspace,
    new.data,
    COALESCE(
      json_extract(new.data, '$.lastModifiedBy'),
      json_extract(new.data, '$.customFields.lastModifiedBy'),
      json_extract(new.data, '$.authorIdentity'),
      json_extract(new.data, '$.customFields.authorIdentity')
    ),
    CASE
      WHEN json_extract(new.data, '$.shared') = 1
        OR json_extract(new.data, '$.share.status') = 'team'
        OR json_extract(new.data, '$.share.body') = 'team'
        OR json_extract(new.data, '$.customFields.share.status') = 'team'
        OR json_extract(new.data, '$.customFields.share.body') = 'team' THEN 1
      WHEN json_extract(new.data, '$.shared') = 0
        OR json_extract(new.data, '$.share.status') = 'private'
        OR json_extract(new.data, '$.share.body') = 'private'
        OR json_extract(new.data, '$.customFields.share.status') = 'private'
        OR json_extract(new.data, '$.customFields.share.body') = 'private' THEN 0
      WHEN new.sync_status IN ('synced', 'pending') THEN 1
      ELSE NULL
    END,
    new.sync_status,
    new.sync_id,
    new.deleted_at;
END;

-- A hard delete is still a state transition. Keep the last field bag and append
-- a tombstone so the chain does not continue to present the deleted item as live.
-- The actor is NULL: the row names its last editor, not whoever deleted it.
CREATE TRIGGER tracker_items_ad_revision AFTER DELETE ON tracker_items
WHEN old.type IN (SELECT type FROM tracker_revision_types)
BEGIN
  INSERT INTO tracker_item_revisions (
    revision_id, item_id, parent_revision_id, workspace, data, actor, published, sync_status, sync_id, deleted_at
  )
  SELECT
    lower(
      substr(hex(randomblob(4)), 1, 8) || '-' ||
      substr(hex(randomblob(2)), 1, 4) || '-4' ||
      substr(hex(randomblob(2)), 2, 3) || '-' ||
      substr('89ab', abs(random()) % 4 + 1, 1) ||
      substr(hex(randomblob(2)), 2, 3) || '-' ||
      hex(randomblob(6))
    ),
    old.id,
    (
      SELECT r.revision_id FROM tracker_item_revisions r
      WHERE r.item_id = old.id
        AND r.revision_id NOT IN (
          SELECT p.parent_revision_id FROM tracker_item_revisions p
          WHERE p.item_id = old.id AND p.parent_revision_id IS NOT NULL
        )
      LIMIT 1
    ),
    old.workspace,
    old.data,
    NULL,
    CASE
      WHEN json_extract(old.data, '$.shared') = 1
        OR json_extract(old.data, '$.share.status') = 'team'
        OR json_extract(old.data, '$.share.body') = 'team'
        OR json_extract(old.data, '$.customFields.share.status') = 'team'
        OR json_extract(old.data, '$.customFields.share.body') = 'team' THEN 1
      WHEN json_extract(old.data, '$.shared') = 0
        OR json_extract(old.data, '$.share.status') = 'private'
        OR json_extract(old.data, '$.share.body') = 'private'
        OR json_extract(old.data, '$.customFields.share.status') = 'private'
        OR json_extract(old.data, '$.customFields.share.body') = 'private' THEN 0
      WHEN old.sync_status IN ('synced', 'pending') THEN 1
      ELSE NULL
    END,
    old.sync_status,
    old.sync_id,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
END;
