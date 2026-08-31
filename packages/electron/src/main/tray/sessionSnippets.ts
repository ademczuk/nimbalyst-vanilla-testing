/**
 * A one-line "what is it actually saying" snippet per session.
 *
 * The tray cache carries state but no content, so a row can say a session is
 * running without saying anything about what it is doing. This reads the latest
 * assistant text straight out of `ai_agent_messages`.
 *
 * Two things make that cheap enough to do at all:
 *
 * - `searchable_text` is already the extracted plain text. Parsing `content`
 *   would mean decoding each provider's raw envelope in the tray, which is the
 *   job `TranscriptTransformer` exists to do exactly once. It is also empty for
 *   `tool`, `meta` and `system` rows, so filtering on it drops the noise for
 *   free -- on a real session, 555 tool rows against 83 assistant ones.
 * - One batched query for every visible session, never one per row. A per-row
 *   query here would be an N+1 against the largest table in the database.
 *
 * Snippets are fetched only while the island is expanded. Nothing about the
 * resting strip needs them, and a query per `session:streaming` tick would be
 * indefensible.
 */

/** Long enough to be a sentence fragment, short enough not to reflow the panel. */
export const SNIPPET_MAX_CHARS = 110;

/** Session ids are ours, but they still get quoted rather than interpolated raw. */
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

/**
 * Reduce a message body to one line.
 *
 * Takes the *last* non-empty line rather than the first: an assistant turn
 * usually opens with preamble and ends with the point, and the trailing line is
 * what "where has it got to" means. Markdown scaffolding (list bullets, heading
 * hashes, fences) is stripped because at this size it reads as noise.
 */
export function toSnippetLine(text: string | null | undefined): string | null {
  if (typeof text !== 'string') return null;

  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('```'));
  if (lines.length === 0) return null;

  const line = lines[lines.length - 1]
    .replace(/^[#>\s]*/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+\.\s+/, '')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!line) return null;

  return line.length > SNIPPET_MAX_CHARS
    ? `${line.slice(0, SNIPPET_MAX_CHARS - 1).trimEnd()}…`
    : line;
}

/**
 * The latest assistant text for each of `sessionIds`, in one query.
 *
 * Returns null when there is nothing to ask about, so the caller can skip the
 * round trip entirely rather than issuing `... IN ()`.
 *
 * Written as a join against a grouped max rather than a window function or a
 * correlated subquery: it is the shape both PGLite and better-sqlite3 plan the
 * same way off `idx_ai_agent_messages_session (session_id, id)`.
 */
export function latestAssistantTextSql(sessionIds: readonly string[]): string | null {
  const ids = sessionIds.filter((id) => SAFE_ID.test(id));
  if (ids.length === 0) return null;

  const list = ids.map((id) => `'${id}'`).join(', ');
  return `
    SELECT m.session_id, m.searchable_text
    FROM ai_agent_messages m
    JOIN (
      SELECT session_id, MAX(id) AS id
      FROM ai_agent_messages
      WHERE session_id IN (${list})
        AND message_kind = 'assistant'
        AND searchable_text IS NOT NULL
        AND searchable_text <> ''
      GROUP BY session_id
    ) latest ON latest.session_id = m.session_id AND latest.id = m.id
  `;
}
