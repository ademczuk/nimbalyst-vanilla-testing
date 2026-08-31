/**
 * The one query that restores unread sessions across a restart.
 *
 * Its own module, away from `TrayManager`, so it can be run against a real
 * better-sqlite3 engine without the Electron surface that file pulls in. That
 * is the whole point: this is the piece of the tray that cannot be read for
 * correctness. It looked right and matched nothing for the entire time SQLite
 * has been a backend, and nothing downstream could tell -- an empty result is
 * indistinguishable from a fleet with nothing unread in it.
 */

/**
 * Sessions that were already unread before this launch, newest first.
 *
 * Two things here are load-bearing:
 *
 * `CAST(... AS TEXT) IN ('true','1')`, not `= 'true'`. The backends disagree
 * about what `->>` yields for a JSON boolean: PGLite gives the text `true`,
 * SQLite gives the integer 1, and SQLite never equates an integer with a
 * string. `= 'true'` is therefore false for every row on SQLite, so every
 * session that went unread before launch was silently absent from the tray menu
 * and the island panel -- sitting in the sidebar with its blue dot, missing
 * from the surface whose whole job is to say it is waiting.
 *
 * `ORDER BY updated_at` rather than a date window. That column is a TIMESTAMPTZ
 * on PGLite and ISO-8601 text on SQLite. Both sort correctly; neither compares
 * against one shared date expression.
 *
 * `limit` is interpolated rather than bound because it is a caller-supplied
 * number and never user input.
 */
export function unreadSeedQuery(limit: number): string {
  // The nested path is what sessionStateListeners writes; the flat one is
  // older rows that predate it.
  return `SELECT id, title, workspace_id, provider, model, updated_at, metadata FROM ai_sessions
     WHERE is_archived = false
       AND (CAST(metadata->'metadata'->>'hasUnread' AS TEXT) IN ('true', '1')
            OR CAST(metadata->>'hasUnread' AS TEXT) IN ('true', '1'))
     ORDER BY updated_at DESC
     LIMIT ${Math.max(1, Math.floor(limit))}`;
}
