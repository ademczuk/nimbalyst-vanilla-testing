/**
 * The local half of a canvas revision's provenance.
 *
 * The room can say when a revision was captured and which member captured it.
 * Everything that makes the rail worth having -- which session produced the
 * content, what it was asked to do, which commit shipped it -- lives only on
 * this machine, in `session_files`, `ai_transcript_events` and
 * `session_commits`. This is the one place that reads all three, keyed by the
 * file a card points at.
 *
 * Three queries, never per-revision. A board can have a dozen revisions on one
 * card and the join that matches them to sessions is pure and runs in the
 * renderer (`assembleCanvasRevisions`); issuing a query per revision would put
 * a dozen round trips on a single-lane DB worker for an answer that is one
 * table scan of the same rows.
 *
 * Nothing here writes.
 */

import { database } from '../database/PGLiteDatabaseWorker';
import { logger } from '../utils/logger';
import { safeHandle } from '../utils/ipcRegistry';
import { toMillis } from '../utils/timestampUtils';

export interface CanvasProvenanceEditRow {
  sessionId: string;
  sessionName: string | null;
  editedAt: number;
  prompt: string | null;
}

export interface CanvasProvenanceCommitRow {
  sha: string;
  subject: string | null;
  sessionId: string;
  committedAt: number;
}

export interface CanvasProvenanceResult {
  success: boolean;
  edits: CanvasProvenanceEditRow[];
  commits: CanvasProvenanceCommitRow[];
  error?: string;
}

const EMPTY: CanvasProvenanceResult = { success: true, edits: [], commits: [] };

/** Placeholders `$2, $3, ...` for a list starting after `$1`. */
function placeholders(count: number, offset: number): string {
  return Array.from({ length: count }, (_, index) => `$${index + offset}`).join(', ');
}

export function setupCanvasRevisionProvenanceHandlers(): void {
  /**
   * Sessions that edited `filePath`, and the commits those sessions landed.
   *
   * `filePath` is workspace-relative. Both stored forms are matched, because
   * `session_files` holds relative paths for older Edit/Write rows and absolute
   * ones for the Bash watcher -- the same reason `sessions:get-file-sessions`
   * looks up both.
   */
  safeHandle(
    'canvas:revision-provenance',
    async (
      _event,
      workspaceId: string,
      filePath: string,
    ): Promise<CanvasProvenanceResult> => {
      if (!workspaceId || !filePath) {
        throw new Error('canvas:revision-provenance requires workspaceId and filePath');
      }
      try {
        const candidatePaths = [filePath, `${workspaceId}/${filePath}`];

        const { rows: editRows } = await database.query<{
          session_id: string;
          title: string | null;
          timestamp: unknown;
        }>(
          `SELECT sf.session_id, s.title, sf.timestamp
             FROM session_files sf
             LEFT JOIN ai_sessions s ON s.id = sf.session_id
            WHERE sf.workspace_id = $1
              AND sf.link_type = 'edited'
              AND sf.file_path IN (${placeholders(candidatePaths.length, 2)})
            ORDER BY sf.timestamp ASC`,
          [workspaceId, ...candidatePaths],
        );
        if (editRows.length === 0) return EMPTY;

        const sessionIds = Array.from(new Set(editRows.map((row) => row.session_id)));

        // The driving prompts for those sessions. Matched to individual edits
        // by the caller, which already knows each edit's timestamp.
        const { rows: promptRows } = await database.query<{
          session_id: string;
          created_at: unknown;
          searchable_text: string | null;
        }>(
          `SELECT session_id, created_at, searchable_text
             FROM ai_transcript_events
            WHERE session_id IN (${placeholders(sessionIds.length, 1)})
              AND event_type = 'user_message'
            ORDER BY created_at ASC`,
          sessionIds,
        );

        const { rows: commitRows } = await database.query<{
          commit_sha: string;
          session_id: string;
          committed_at: unknown;
        }>(
          `SELECT commit_sha, session_id, committed_at
             FROM session_commits
            WHERE session_id IN (${placeholders(sessionIds.length, 1)})
            ORDER BY committed_at ASC`,
          sessionIds,
        );

        const promptsBySession = new Map<
          string,
          { at: number; text: string }[]
        >();
        for (const row of promptRows) {
          const at = toMillis(row.created_at);
          const text = row.searchable_text?.trim();
          if (at === null || !text) continue;
          const list = promptsBySession.get(row.session_id) ?? [];
          list.push({ at, text });
          promptsBySession.set(row.session_id, list);
        }

        const edits = editRows.flatMap<CanvasProvenanceEditRow>((row) => {
          const editedAt = toMillis(row.timestamp);
          if (editedAt === null) return [];
          return [
            {
              sessionId: row.session_id,
              sessionName: row.title ?? null,
              editedAt,
              // The last thing the user asked before the edit landed. A prompt
              // issued after it drove some later edit, not this one.
              prompt:
                promptsBySession
                  .get(row.session_id)
                  ?.filter((prompt) => prompt.at <= editedAt)
                  .at(-1)?.text ?? null,
            },
          ];
        });

        const commits = commitRows.flatMap<CanvasProvenanceCommitRow>((row) => {
          const committedAt = toMillis(row.committed_at);
          if (committedAt === null) return [];
          return [
            {
              sha: row.commit_sha,
              // `session_commits` records the attribution, not the message.
              // The rail shows the short sha; a subject would be a second
              // round trip to git for one line of chrome.
              subject: null,
              sessionId: row.session_id,
              committedAt,
            },
          ];
        });

        return { success: true, edits, commits };
      } catch (error) {
        logger.main.error('[CanvasRevisionProvenance] lookup failed:', error);
        return {
          success: false,
          edits: [],
          commits: [],
          error: String(error),
        };
      }
    },
  );
}
