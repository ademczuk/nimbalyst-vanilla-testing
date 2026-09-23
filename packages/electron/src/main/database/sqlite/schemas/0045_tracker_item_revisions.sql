-- ----------------------------------------------------------------------------
-- 0045_tracker_item_revisions
--
-- Append-only revision history for tracker items, per the knowledge-scopes
-- contract 4.2: a knowledge claim cites an EXACT revision, so a revision that
-- was readable once must stay readable forever.
--
-- IDENTITY IS A UUID, NOT A LOCAL COUNTER. This follows the model tracker
-- identity already uses: item ids are ULIDs and issue keys (`NIM-123`) are
-- minted by the room on publication, never locally. A locally assigned
-- sequence number would mean "revision 3" names a different write on each
-- machine, so a citation pinning it is ambiguous until the server renumbers
-- everything. `server_revision` is the only sequential number and it is
-- assigned by the room on sync; it stays NULL for personal and unsynced items.
--
-- Ordering does not depend on the number OR on the clock. `parent_revision_id`
-- is the chain and the tip is the revision no other revision claims as parent.
-- Two writes inside one millisecond share a `recorded_at`, and a random UUID
-- tie-break would then invert real history, so nothing here sorts by time.
--
-- Why a trigger and not a hook in TrackerPGLiteStore: the store is only one of
-- a dozen writers of `tracker_items`. The others include the native publish
-- path (ElectronDocumentService.setTrackerItemPublished), file-backed body
-- publication, the MCP tool handlers, CommitTrackerLinker, and the backfills.
-- A hook in the store would have silently recorded no revision for exactly the
-- write that matters most. The trigger catches every writer by construction,
-- the same reasoning as the FTS triggers in 0004/0008. The triggers, and the
-- scope that limits them to knowledge types, are in 0047.
--
-- The log is append-only: it is the only place a superseded field bag
-- survives, so nothing may DELETE from it. Deleting a tracker_items row
-- deliberately does NOT delete its revisions.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tracker_item_revisions (
  -- Random v4 UUID, unique from birth, assigned wherever the write happened.
  revision_id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  -- The revision this one superseded. NULL for an item's first revision.
  parent_revision_id TEXT,
  -- Sequential display number, assigned by the room on sync. NULL means this
  -- revision has never been to the server; it does NOT mean "revision 0".
  server_revision INTEGER,
  workspace TEXT NOT NULL,
  -- Full field bag as of this revision, not a delta: a citation pins one
  -- revision and must render it without replaying the chain.
  data TEXT NOT NULL,
  -- Identity JSON lifted from the payload. The writer is not always known
  -- (backfills, imports), so this is nullable rather than invented.
  actor TEXT,
  -- 1 published, 0 draft, NULL undetermined.
  --
  -- Publication is `getItemPublicationState` in trackerRecordAccessors.ts, and
  -- its last branch reads the tracker SCHEMA (`model.draftByDefault`), which
  -- SQL has no access to. The row-evident cases are recorded here; the case
  -- that needs the schema is left NULL for the reader to resolve, rather than
  -- guessed. Do not treat NULL as draft.
  published INTEGER,
  sync_status TEXT,
  sync_id INTEGER,
  -- Non-null marks a tombstone revision. The last field bag is retained so a
  -- reader can still explain what was deleted.
  deleted_at TEXT,
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_tracker_item_revisions_item
  ON tracker_item_revisions(workspace, item_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_tracker_item_revisions_parent
  ON tracker_item_revisions(parent_revision_id) WHERE parent_revision_id IS NOT NULL;
-- The room owns this number, so two revisions of one item may never claim the
-- same one.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tracker_item_revisions_server
  ON tracker_item_revisions(item_id, server_revision) WHERE server_revision IS NOT NULL;

