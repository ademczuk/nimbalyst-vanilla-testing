// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  isTombstoned,
  tombstoneAppServerEnvelope,
  tombstoneClaudeCodeChunk,
  tombstoneRawContent,
} from '../toolOutputRetention';
import { rawMessagesToCanonicalEvents } from '../../ai/server/transcript/projectRawMessages';
import type { RawMessage } from '../../ai/server/transcript/TranscriptTransformer';

const DATE = '2026-05-01T12:00:00.000Z';
const BIG_OUTPUT = 'stdout line\n'.repeat(5000);

function rawMessage(partial: Partial<RawMessage> & { content: string }): RawMessage {
  return {
    id: 1,
    sessionId: 'session-1',
    source: 'claude-code',
    direction: 'output',
    createdAt: new Date(DATE),
    ...partial,
  };
}

const TOOL_CALL = JSON.stringify({
  type: 'assistant',
  message: {
    content: [{ type: 'tool_use', id: 'toolu_01', name: 'Bash', input: { command: 'npm test' } }],
  },
});

function toolResultRow(content: unknown) {
  return JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content: [{ tool_use_id: 'toolu_01', type: 'tool_result', content }],
    },
  });
}

describe('tombstoneRawContent', () => {
  it('shrinks an aged claude-code tool result and marks it', () => {
    const before = toolResultRow(BIG_OUTPUT);
    const after = tombstoneRawContent(before, 'claude-code', DATE);

    expect(after).not.toBeNull();
    expect(after!.length).toBeLessThan(before.length / 10);
    expect(after).toContain('Output discarded to reclaim disk');
    expect(after).toContain('2026-05-01');
    // The link back to the call it answers must survive.
    expect(after).toContain('toolu_01');
  });

  it('is idempotent -- a second pass issues no write', () => {
    const once = tombstoneRawContent(toolResultRow(BIG_OUTPUT), 'claude-code', DATE);
    expect(tombstoneRawContent(once!, 'claude-code', DATE)).toBeNull();
  });

  it('leaves a tool_use call untouched however large', () => {
    const bigWrite = JSON.stringify({
      type: 'assistant',
      message: {
        content: [{
          type: 'tool_use',
          id: 'toolu_02',
          name: 'Write',
          input: { content: 'plan line\n'.repeat(10_000) },
        }],
      },
    });
    expect(tombstoneRawContent(bigWrite, 'claude-code', DATE)).toBeNull();
  });

  it('leaves small results alone rather than paying a write to save nothing', () => {
    expect(tombstoneRawContent(toolResultRow('ok'), 'claude-code', DATE)).toBeNull();
  });

  it('refuses to guess at an unrecognized provider shape', () => {
    expect(tombstoneRawContent(toolResultRow(BIG_OUTPUT), 'some-new-agent', DATE)).toBeNull();
  });

  it('returns null on unparseable content instead of destroying it', () => {
    expect(tombstoneRawContent('not json at all', 'claude-code', DATE)).toBeNull();
  });
});

describe('tombstoneClaudeCodeChunk', () => {
  it('keeps image blocks while discarding text', () => {
    const image = { type: 'image', source: { type: 'base64', data: 'A'.repeat(2000) } };
    const chunk = JSON.parse(toolResultRow([{ type: 'text', text: BIG_OUTPUT }, image]));

    const out = tombstoneClaudeCodeChunk(chunk, DATE) as typeof chunk;
    const blocks = out.message.content[0].content;

    expect(isTombstoned(blocks[0].text)).toBe(true);
    expect(blocks[1]).toEqual(image);
  });

  it('does not mutate its input', () => {
    const chunk = JSON.parse(toolResultRow(BIG_OUTPUT));
    tombstoneClaudeCodeChunk(chunk, DATE);
    expect(chunk.message.content[0].content).toBe(BIG_OUTPUT);
  });
});

describe('tombstoneAppServerEnvelope', () => {
  it('discards aggregatedOutput but keeps what the tool card renders', () => {
    const envelope = {
      method: 'item/completed',
      params: {
        item: {
          id: 'exec-1',
          type: 'commandExecution',
          status: 'completed',
          command: 'npm test',
          exitCode: 1,
          aggregatedOutput: BIG_OUTPUT,
        },
      },
    };

    const out = tombstoneAppServerEnvelope(envelope, DATE) as typeof envelope;

    expect(isTombstoned(out.params.item.aggregatedOutput)).toBe(true);
    expect(out.params.item.exitCode).toBe(1);
    expect(out.params.item.command).toBe('npm test');
    expect(out.params.item.status).toBe('completed');
  });
});

describe('transcript projection after tombstoning', () => {
  it('still produces the same event shape, with a placeholder result', async () => {
    // The load-bearing assertion for Layer 2: run the REAL parser pipeline, not
    // a hand-built approximation. If a tombstone stopped parsing as a
    // tool_result, the tool card would vanish from the transcript entirely
    // rather than showing a discarded body.
    const original: RawMessage[] = [
      rawMessage({ id: 1, content: TOOL_CALL }),
      rawMessage({ id: 2, content: toolResultRow(BIG_OUTPUT) }),
    ];
    const tombstonedContent = tombstoneRawContent(
      toolResultRow(BIG_OUTPUT),
      'claude-code',
      DATE,
    )!;
    const tombstoned: RawMessage[] = [
      rawMessage({ id: 1, content: TOOL_CALL }),
      rawMessage({ id: 2, content: tombstonedContent }),
    ];

    const before = await rawMessagesToCanonicalEvents(original, 'claude-code');
    const after = await rawMessagesToCanonicalEvents(tombstoned, 'claude-code');

    expect(after.length).toBe(before.length);
    expect(after.map((e) => e.eventType)).toEqual(before.map((e) => e.eventType));

    const beforeJson = JSON.stringify(before);
    const afterJson = JSON.stringify(after);
    expect(beforeJson).toContain('stdout line');
    expect(afterJson).not.toContain('stdout line');
    expect(afterJson).toContain('Output discarded to reclaim disk');
    // The tool name must survive so the card still says what ran.
    expect(afterJson).toContain('Bash');
  });
});
