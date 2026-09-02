/**
 * sessionCoachingSignals -- pure extraction behind `get_session_coaching_signals`.
 *
 * The coach command (`/planning:nimbalyst-coach`, planning extension) needs per-session
 * evidence that `get_session_summary` cannot give it: which tools the agent
 * actually reached for, and which tracker items the session is linked to.
 * Without those, findings like "you asked the agent to read the logs" or
 * "nothing in this workspace links a tracker item" can only be answered by a
 * SQL tool, which most users do not have installed.
 *
 * Everything here is pure: rows in, signals out. The database read and the
 * workspace authorization live in the dispatcher (`sessionContextServer.ts`) so
 * the interesting decisions can be tested without a database. `searchableTextExtractor`
 * already classifies each row's *kind*, but it deliberately collapses tool rows
 * to `{ text: null, kind: 'tool' }` and never names the tool -- so the tool-name
 * normalization below is genuinely new work, not a duplicate of that module.
 */

/** One row of `ai_agent_messages`, narrowed to the columns this module reads. */
export interface CoachingMessageRow {
  content: string;
  message_kind: string | null;
  searchable_text: string | null;
  metadata: Record<string, unknown> | string | null;
  hidden: boolean | null;
}

export interface ToolUsage {
  name: string;
  count: number;
}

export interface CoachingSignals {
  turnCount: number;
  userPrompts: string[];
  toolUsage: ToolUsage[];
  /** True when prompt text or the tool list was truncated by the caps below. */
  truncated: boolean;
}

// ─── Caps ───────────────────────────────────────────────────────────
//
// A 30-session review multiplies every one of these by 30. They exist so the
// coach cannot flood its own context and lose the ability to reason about what
// it read. Sized to keep a full review well inside a single context window.

export const MAX_USER_PROMPTS = 40;
export const MAX_PROMPT_CHARS = 600;
export const MAX_DISTINCT_TOOLS = 40;
export const MAX_FILES_EDITED = 50;

/**
 * Prompt text that is machine-authored rather than typed by the user.
 *
 * These reach `message_kind = 'user'` because they enter through the same write
 * path as a real prompt. Counting them as user evidence is how a coach ends up
 * "quoting" the user saying something they never said -- the single most
 * damaging failure this command can have, because every finding is supposed to
 * be backed by the user's own words.
 */
const SYNTHETIC_PROMPT_PREFIXES = [
  '[System:',
  '<system-reminder>',
  '<SYSTEM_REMINDER>',
  '<command-message>',
  '<local-command-stdout>',
  '<task-notification>',
  'Caveat: The messages below',
];

const SYNTHETIC_PROMPT_ORIGINS = new Set([
  'wakeup_resume',
  'session_brief',
  'auto_continue',
]);

function parseMetadata(
  metadata: Record<string, unknown> | string | null,
): Record<string, unknown> | null {
  // SQLite hands back a JSON string where PGLite hands back a parsed object.
  // See packages/electron/DATABASE.md -- the standard defensive idiom.
  if (metadata == null) return null;
  if (typeof metadata === 'string') {
    try {
      const parsed = JSON.parse(metadata);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return metadata;
}

function safeJsonParse(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

/**
 * True when a `user`-kind row was authored by the machine rather than typed.
 */
export function isSyntheticPrompt(
  text: string,
  metadata: Record<string, unknown> | string | null,
): boolean {
  const meta = parseMetadata(metadata);
  const origin = meta?.promptOrigin;
  if (typeof origin === 'string' && SYNTHETIC_PROMPT_ORIGINS.has(origin)) return true;
  if (meta?.promptType === 'system_reminder') return true;
  if (meta?.isGeneratedBrief === true) return true;

  const trimmed = text.trimStart();
  return SYNTHETIC_PROMPT_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

// ─── Tool-name normalization ────────────────────────────────────────

/**
 * Pull canonical tool names out of one raw provider row.
 *
 * Shapes, all confirmed against the canonical parsers rather than guessed:
 *  - claude-code    `{type:'assistant', message:{content:[{type:'tool_use', name}]}}`
 *  - nimbalyst      `{type:'nimbalyst_tool_use', name}` (interactive prompt widgets)
 *  - codex          `{method:'item/started'|'item/completed', params:{item:{type,...}}}`
 *                   where `mcpToolCall` carries `{server, tool}` and the other
 *                   tool-like item types map to a stable synthetic name
 *  - gemini         `metadata.role === 'tool'`, content `{name, args, result}`
 *
 * A row that carries no tool call yields an empty array. Unknown shapes yield
 * an empty array rather than a guessed name -- an invented tool name would show
 * up in the report as evidence, which is worse than a missing row.
 */
export function extractToolNames(row: CoachingMessageRow): string[] {
  const meta = parseMetadata(row.metadata);
  const parsed = safeJsonParse(row.content);

  // Gemini distinguishes its tool rows by metadata role, not by a type tag.
  if (meta?.role === 'tool') {
    if (parsed && typeof parsed === 'object') {
      const name = (parsed as { name?: unknown }).name;
      if (typeof name === 'string' && name.length > 0) return [name];
    }
    return [];
  }

  if (!parsed || typeof parsed !== 'object') return [];
  const p = parsed as {
    type?: unknown;
    name?: unknown;
    message?: { content?: unknown };
    method?: unknown;
    params?: { item?: Record<string, unknown> };
  };

  if (p.type === 'nimbalyst_tool_use') {
    return typeof p.name === 'string' && p.name.length > 0 ? [p.name] : [];
  }

  if (p.type === 'assistant' && p.message && Array.isArray(p.message.content)) {
    const names: string[] = [];
    for (const block of p.message.content) {
      if (!block || typeof block !== 'object') continue;
      const b = block as { type?: unknown; name?: unknown };
      if (b.type === 'tool_use' && typeof b.name === 'string' && b.name.length > 0) {
        names.push(b.name);
      }
    }
    return names;
  }

  // Codex app-server. Only `item/started` is counted: `item/completed` fires for
  // the same call and would double every codex tool count.
  if (p.method === 'item/started' && p.params && typeof p.params === 'object') {
    const item = p.params.item;
    if (!item || typeof item !== 'object') return [];
    const name = codexItemToolName(item);
    return name ? [name] : [];
  }

  return [];
}

function codexItemToolName(item: Record<string, unknown>): string | null {
  const type = item.type;
  if (type === 'mcpToolCall') {
    const server = item.server;
    const tool = item.tool;
    if (typeof server === 'string' && typeof tool === 'string') {
      return `mcp__${server}__${tool}`;
    }
    return null;
  }
  if (type === 'commandExecution') return 'Bash';
  if (type === 'fileChange') return 'Edit';
  if (type === 'collabAgentToolCall') return 'CollabAgentTool';
  return null;
}

// ─── Aggregation ────────────────────────────────────────────────────

/**
 * Derive the coaching signals for one session from its raw message rows.
 *
 * `rows` must be in ascending id order (the query orders by id) so the prompt
 * list reads chronologically.
 */
export function deriveCoachingSignals(rows: CoachingMessageRow[]): CoachingSignals {
  const userPrompts: string[] = [];
  const toolCounts = new Map<string, number>();
  let turnCount = 0;
  let truncated = false;

  for (const row of rows) {
    if (row.hidden) continue;

    if (row.message_kind === 'user') {
      const text = row.searchable_text ?? '';
      if (text.length === 0) continue;
      if (isSyntheticPrompt(text, row.metadata)) continue;
      turnCount += 1;
      if (userPrompts.length < MAX_USER_PROMPTS) {
        if (text.length > MAX_PROMPT_CHARS) {
          userPrompts.push(`${text.slice(0, MAX_PROMPT_CHARS)}...`);
          truncated = true;
        } else {
          userPrompts.push(text);
        }
      } else {
        truncated = true;
      }
      continue;
    }

    for (const name of extractToolNames(row)) {
      toolCounts.set(name, (toolCounts.get(name) ?? 0) + 1);
    }
  }

  const sorted = Array.from(toolCounts.entries())
    .map(([name, count]) => ({ name, count }))
    // Highest count first; ties alphabetical so output is stable across runs.
    .sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name));

  if (sorted.length > MAX_DISTINCT_TOOLS) truncated = true;

  return {
    turnCount,
    userPrompts,
    toolUsage: sorted.slice(0, MAX_DISTINCT_TOOLS),
    truncated,
  };
}
