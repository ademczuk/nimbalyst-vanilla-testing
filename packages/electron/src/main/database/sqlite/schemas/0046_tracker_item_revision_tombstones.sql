-- ----------------------------------------------------------------------------
-- 0046_tracker_item_revision_tombstones
--
-- Intentionally empty. During development this version added the
-- `deleted_at` tombstone column to a draft of 0045 that lacked it. 0045 now
-- creates the column itself, so there is nothing left to do, but the version
-- stays so databases that recorded it keep a contiguous history.
-- ----------------------------------------------------------------------------

SELECT 1;
