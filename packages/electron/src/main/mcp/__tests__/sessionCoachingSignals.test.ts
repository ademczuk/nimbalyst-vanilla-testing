// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  MAX_DISTINCT_TOOLS,
  MAX_PROMPT_CHARS,
  MAX_USER_PROMPTS,
  deriveCoachingSignals,
  extractToolNames,
  type CoachingMessageRow,
} from '../sessionCoachingSignals';

function row(partial: Partial<CoachingMessageRow>): CoachingMessageRow {
  return {
    content: '',
    message_kind: null,
    searchable_text: null,
    metadata: null,
    hidden: false,
    ...partial,
  };
}

function userRow(text: string, metadata: CoachingMessageRow['metadata'] = null): CoachingMessageRow {
  return row({ message_kind: 'user', searchable_text: text, metadata });
}

function claudeToolRow(...names: string[]): CoachingMessageRow {
  return row({
    message_kind: 'tool',
    content: JSON.stringify({
      type: 'assistant',
      message: { content: names.map((name) => ({ type: 'tool_use', name, input: {} })) },
    }),
  });
}

describe('extractToolNames', () => {
  it('names every tool_use block in a claude-code assistant row', () => {
    expect(extractToolNames(claudeToolRow('Read', 'Bash'))).toEqual(['Read', 'Bash']);
  });

  it('names a nimbalyst interactive-prompt tool row', () => {
    const r = row({ content: JSON.stringify({ type: 'nimbalyst_tool_use', id: 'x', name: 'ToolPermission' }) });
    expect(extractToolNames(r)).toEqual(['ToolPermission']);
  });

  it('builds the mcp__server__tool name from a codex mcpToolCall', () => {
    const r = row({
      content: JSON.stringify({
        method: 'item/started',
        params: { item: { type: 'mcpToolCall', id: '1', server: 'nimbalyst-trackers', tool: 'tracker_create' } },
      }),
    });
    expect(extractToolNames(r)).toEqual(['mcp__nimbalyst-trackers__tracker_create']);
  });

  it('maps codex command and file items to stable synthetic names', () => {
    const cmd = row({
      content: JSON.stringify({ method: 'item/started', params: { item: { type: 'commandExecution' } } }),
    });
    const file = row({
      content: JSON.stringify({ method: 'item/started', params: { item: { type: 'fileChange' } } }),
    });
    expect(extractToolNames(cmd)).toEqual(['Bash']);
    expect(extractToolNames(file)).toEqual(['Edit']);
  });

  it('ignores codex item/completed so one call is not counted twice', () => {
    const started = {
      method: 'item/started',
      params: { item: { type: 'mcpToolCall', server: 's', tool: 't' } },
    };
    const completed = { ...started, method: 'item/completed' };
    expect(extractToolNames(row({ content: JSON.stringify(started) }))).toHaveLength(1);
    expect(extractToolNames(row({ content: JSON.stringify(completed) }))).toHaveLength(0);
  });

  it('reads a gemini tool row off metadata.role, including when metadata is a JSON string', () => {
    const content = JSON.stringify({ name: 'run_shell_command', args: {}, result: 'ok' });
    expect(extractToolNames(row({ content, metadata: { role: 'tool' } }))).toEqual(['run_shell_command']);
    // SQLite hands metadata back as a string where PGLite hands back an object.
    expect(extractToolNames(row({ content, metadata: '{"role":"tool"}' }))).toEqual(['run_shell_command']);
  });

  it('returns nothing rather than a guess for unknown or unparseable shapes', () => {
    expect(extractToolNames(row({ content: 'not json' }))).toEqual([]);
    expect(extractToolNames(row({ content: JSON.stringify({ type: 'mystery', name: 'Nope' }) }))).toEqual([]);
  });
});

describe('deriveCoachingSignals', () => {
  it('counts tool calls across providers and orders them by frequency', () => {
    const signals = deriveCoachingSignals([
      claudeToolRow('Read'),
      claudeToolRow('Read'),
      claudeToolRow('Bash'),
      claudeToolRow('Read'),
    ]);
    expect(signals.toolUsage).toEqual([
      { name: 'Read', count: 3 },
      { name: 'Bash', count: 1 },
    ]);
  });

  it('excludes machine-authored prompts from the user evidence', () => {
    const signals = deriveCoachingSignals([
      userRow('fix the login bug'),
      userRow('[System: resuming session]'),
      userRow('<system-reminder>context</system-reminder>'),
      userRow('continuing', { promptOrigin: 'wakeup_resume' }),
      userRow('here is a brief', '{"isGeneratedBrief":true}'),
      userRow('and check the logs yourself'),
    ]);
    expect(signals.userPrompts).toEqual(['fix the login bug', 'and check the logs yourself']);
    expect(signals.turnCount).toBe(2);
  });

  it('skips hidden rows entirely', () => {
    const signals = deriveCoachingSignals([
      row({ message_kind: 'user', searchable_text: 'hidden prompt', hidden: true }),
      { ...claudeToolRow('Read'), hidden: true },
    ]);
    expect(signals.userPrompts).toEqual([]);
    expect(signals.toolUsage).toEqual([]);
  });

  it('caps prompt text, prompt count, and tool cardinality, and flags the truncation', () => {
    const long = 'x'.repeat(MAX_PROMPT_CHARS + 50);
    const many = Array.from({ length: MAX_USER_PROMPTS + 5 }, (_, i) => userRow(`prompt ${i}`));
    const tools = Array.from({ length: MAX_DISTINCT_TOOLS + 5 }, (_, i) => claudeToolRow(`Tool${i}`));

    const capped = deriveCoachingSignals([userRow(long)]);
    expect(capped.userPrompts[0]).toHaveLength(MAX_PROMPT_CHARS + 3);
    expect(capped.truncated).toBe(true);

    const overflow = deriveCoachingSignals([...many, ...tools]);
    expect(overflow.userPrompts).toHaveLength(MAX_USER_PROMPTS);
    expect(overflow.toolUsage).toHaveLength(MAX_DISTINCT_TOOLS);
    expect(overflow.truncated).toBe(true);
    // turnCount reports the real total even when the prompt list is capped,
    // so "N turns" in the report stays honest.
    expect(overflow.turnCount).toBe(MAX_USER_PROMPTS + 5);
  });

  it('reports no truncation for an ordinary session', () => {
    const signals = deriveCoachingSignals([userRow('short'), claudeToolRow('Read')]);
    expect(signals.truncated).toBe(false);
  });
});
