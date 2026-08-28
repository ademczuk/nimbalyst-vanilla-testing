// @vitest-environment node
/**
 * Runs the Grok and Cursor record mappers over the NDJSON captured from the
 * real CLIs during the Phase 0 transport bake-off (2026-08-26).
 *
 * These fixtures are the regression net for the thing that decided the
 * transport in the first place: whether an edit turn yields a path and a
 * before/after baseline. Both CLIs are young and churning — when one renames a
 * field, this is what says so.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { mapGrokRecord } from '../GrokBuildProtocol';
import { mapCursorRecord } from '../CursorAgentProtocol';
import { HeadlessAgentRawParser } from '../../transcript/parsers/HeadlessAgentRawParser';
import type { ProtocolEvent, ToolResult } from '../ProtocolInterface';
import type { ParseContext } from '../../transcript/parsers/IRawMessageParser';
import type { RawMessage } from '../../transcript/TranscriptTransformer';

const FIXTURE_DIR = path.join(__dirname, '..', '..', 'transcript', '__tests__', 'fixtures');
const WORKSPACE = '/private/tmp/acp-bakeoff-7zTW';

function loadFixture(name: string): Array<Record<string, unknown>> {
  return readFileSync(path.join(FIXTURE_DIR, name), 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function changesOf(event: ProtocolEvent): Array<Record<string, unknown>> {
  const result = event.toolResult?.result;
  if (!result || typeof result === 'string') return [];
  return ((result as ToolResult).changes as Array<Record<string, unknown>>) ?? [];
}

describe('Grok Build streaming-json mapping', () => {
  const events = loadFixture('grokBuildStreamingJson.editTurn.ndjson')
    .flatMap((record) => mapGrokRecord(record, WORKSPACE));

  it('reports the edit with an absolute path and the exact replaced text', () => {
    const change = events.flatMap(changesOf).find((c) => String(c.path).endsWith('alpha.txt'));
    expect(change).toMatchObject({
      path: `${WORKSPACE}/alpha.txt`,
      kind: 'update',
      beforeContent: 'line two',
      afterContent: 'line TWO edited',
    });
  });

  it('absolutizes the relative file_path Grok puts in edit tool arguments', () => {
    // `rawInput.file_path` arrives as bare `alpha.txt`; file tracking resolves
    // paths against the workspace and would otherwise miss the file entirely.
    const edit = events.find((e) => e.toolCall?.name === 'search_replace');
    expect(edit?.toolCall?.arguments?.file_path).toBe(`${WORKSPACE}/alpha.txt`);
  });

  it('leaves the delete and rename visible only as shell commands', () => {
    // The reason Grok is 'tool-args' and not 'structured': there is no delete
    // or move tool, so the watcher has to stay on. If Grok ever grows one,
    // this assertion is what will fail and prompt the fidelity upgrade.
    const shellCommands = events
      .filter((e) => e.toolCall?.name === 'run_terminal_command')
      .map((e) => e.toolCall?.arguments?.command);
    expect(shellCommands).toContain('rm doomed.txt');
    expect(shellCommands).toContain('mv mover.txt moved.txt');
    expect(events.flatMap(changesOf).some((c) => c.kind === 'delete')).toBe(false);
  });

  it('closes the turn with token counts and no context window', () => {
    const complete = events.find((e) => e.type === 'complete');
    expect(complete?.usage?.total_tokens).toBeGreaterThan(0);
    // A denominator here would let the UI render a fill percentage Grok never
    // reported (#914).
    expect(complete?.contextWindow).toBeUndefined();
  });
});

describe('Cursor Agent stream-json mapping', () => {
  const events = loadFixture('cursorAgentStreamJson.editTurn.ndjson')
    .flatMap((record) => mapCursorRecord(record));

  it('reports the edit with a pre-edit baseline, not just a diff', () => {
    // `beforeFullFileContent` is what earns this provider 'structured'
    // fidelity: it is a better baseline than the snapshot cache can infer.
    const change = events.flatMap(changesOf).find((c) => c.kind === 'update');
    expect(change?.path).toBe(`${WORKSPACE}/alpha.txt`);
    expect(change?.beforeContent).toBe('line one\nline two\nline three\n');
    expect(String(change?.diff)).toContain('+line TWO edited');
  });

  it('reports the delete as a typed change carrying the removed contents', () => {
    const change = events.flatMap(changesOf).find((c) => c.kind === 'delete');
    expect(change).toMatchObject({
      path: `${WORKSPACE}/doomed.txt`,
      beforeContent: 'delete me\n',
      afterContent: null,
    });
  });

  it('surfaces shell calls with their command and exit code', () => {
    const shell = events.find(
      (e) => e.toolResult?.name === 'shell'
        && (e.toolResult.result as ToolResult)?.command === 'echo hello-from-shell',
    );
    expect((shell?.toolResult?.result as ToolResult)?.exit_code).toBe(0);
  });

  it('closes the turn with token counts and no context window', () => {
    const complete = events.find((e) => e.type === 'complete');
    expect(complete?.usage?.input_tokens).toBeGreaterThan(0);
    expect(complete?.contextWindow).toBeUndefined();
  });
});

describe('HeadlessAgentRawParser transcript projection', () => {
  const context = {} as ParseContext;

  function outputRow(record: unknown): RawMessage {
    return { direction: 'output', content: JSON.stringify(record) } as RawMessage;
  }

  async function parseAll(kind: 'grok-build' | 'cursor-agent', fixture: string) {
    const parser = new HeadlessAgentRawParser(kind);
    const rows = loadFixture(fixture);
    const events = [];
    for (const record of rows) {
      events.push(...await parser.parseMessage(outputRow(record), context));
    }
    return events;
  }

  it('turns Cursor tool calls into started/completed pairs with the target file', async () => {
    const events = await parseAll('cursor-agent', 'cursorAgentStreamJson.editTurn.ndjson');
    const started = events.find(
      (e) => e.type === 'tool_call_started' && e.toolName === 'edit',
    ) as Extract<typeof events[number], { type: 'tool_call_started' }>;
    expect(started.targetFilePath).toBe(`${WORKSPACE}/alpha.txt`);
    // Without the id pairing, the transcript renders a tool call that never
    // finishes and the spinner runs forever.
    expect(events.some(
      (e) => e.type === 'tool_call_completed' && e.providerToolCallId === started.providerToolCallId,
    )).toBe(true);
  });

  it('drops per-token deltas and renders the turn-final assistant message', async () => {
    const parser = new HeadlessAgentRawParser('grok-build');
    const deltas = await parser.parseMessage(
      outputRow({ type: 'text', data: 'partial' }), context,
    );
    // Emitting these would duplicate the whole response alongside item.completed.
    expect(deltas).toEqual([]);

    const final = await parser.parseMessage(
      outputRow({
        type: 'item.completed',
        item: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done.' }] },
      }),
      context,
    );
    expect(final).toEqual([{ type: 'assistant_message', text: 'Done.', createdAt: undefined }]);
  });

  it('marks a failed tool call as an error rather than a silent success', async () => {
    const parser = new HeadlessAgentRawParser('grok-build');
    const events = await parser.parseMessage(
      outputRow({ type: 'tool_call_update', status: 'failed', toolCallId: 'call-1', rawOutput: { err: 'nope' } }),
      context,
    );
    expect(events).toMatchObject([{ type: 'tool_call_completed', status: 'error', isError: true }]);
  });
});
