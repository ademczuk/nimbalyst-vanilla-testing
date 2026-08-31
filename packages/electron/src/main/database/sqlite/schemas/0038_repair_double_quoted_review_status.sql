-- Repair document_history rows whose review status was double-encoded (#1403).
--
-- `HistoryManager` retires a pending-review tag with a literal jsonb value:
--
--     jsonb_set(metadata, '{status}', '"reviewed"')
--
-- In Postgres that third argument is typed jsonb, so the literal is parsed as
-- JSON and the stored value is the string `reviewed`. The dialect translator
-- rewrote it to SQLite's `json_set`, which stores whatever text it is handed --
-- so the value landed as the 10-character string `"reviewed"`, quotes included:
--
--     {"status": "\"reviewed\""}
--
-- That value satisfies neither `= 'pending-review'` nor `= 'reviewed'`, so the
-- affected rows became invisible to every reader. The badge symptom the issue
-- reported happens to disappear too, which is why this went unnoticed: the row
-- stops claiming the diff bar because it stops matching anything at all.
--
-- The translator now wraps literal jsonb_set values in `json()`, so no new rows
-- can reach this state. This pass fixes the ones already written -- 2,613 on the
-- machine where it was found, via the pending-review retention pass and the two
-- clear-all-pending paths that share the idiom.
--
-- Status only. The `content` BLOB holding the pre-edit baseline is untouched,
-- and `reviewed` is the value these rows were always meant to carry, so nothing
-- here loses data or changes any row's meaning.

UPDATE document_history
SET metadata = json_set(metadata, '$.status', 'reviewed')
WHERE json_extract(metadata, '$.status') = '"reviewed"';
